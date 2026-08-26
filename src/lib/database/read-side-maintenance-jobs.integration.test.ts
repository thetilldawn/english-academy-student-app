import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const readMigration = (name: string) =>
  fs.readFileSync(path.resolve("supabase/migrations", name), "utf8");

const stateAndFinalizerMigration = readMigration(
  "20260826000220_split_read_side_maintenance_jobs.sql",
);
const workerMigration = readMigration(
  "20260826001639_add_read_side_maintenance_workers.sql",
);
const retryStudentIndexMigration = readMigration(
  "20260826001642_index_maintenance_retry_student.sql",
);
const scheduleMigrationName =
  "20260826001655_schedule_read_side_maintenance_jobs.sql";
const scheduleMigration = readMigration(scheduleMigrationName);
const bodyMigrationNames = [
  "20260826000220_split_read_side_maintenance_jobs.sql",
  "20260826001635_add_ready_queue_fixed_time_materializer.sql",
  "20260826001639_add_read_side_maintenance_workers.sql",
  "20260826001642_index_maintenance_retry_student.sql",
  "20260826001648_preserve_untimed_assignment_deadlines.sql",
  "20260826001650_add_targeted_admin_deletion_commands.sql",
  "20260826001652_bound_student_session_renewal.sql",
] as const;

const ids = {
  badStudent: "00000000-0000-4000-8000-000000000001",
  firstStudent: "00000000-0000-4000-8000-000000000002",
  orderedStudent: "00000000-0000-4000-8000-000000000003",
  retryStudent: "00000000-0000-4000-8000-000000000004",
  attentionStudent: "00000000-0000-4000-8000-000000000005",
  assignedStudent: "00000000-0000-4000-8000-000000000006",
  backlogFirstStudent: "00000000-0000-4000-8000-000000000007",
  backlogSecondStudent: "00000000-0000-4000-8000-000000000008",
  backlogThirdStudent: "00000000-0000-4000-8000-000000000009",
  badAttempt: "00000000-0000-4000-8000-000000000101",
  firstAttempt: "00000000-0000-4000-8000-000000000102",
  orderedFirstAttempt: "00000000-0000-4000-8000-000000000103",
  orderedSecondAttempt: "00000000-0000-4000-8000-000000000104",
  backlogFirstAttempt: "00000000-0000-4000-8000-000000000105",
  backlogSecondAttempt: "00000000-0000-4000-8000-000000000106",
  backlogThirdAttempt: "00000000-0000-4000-8000-000000000107",
  badDraft: "00000000-0000-4000-8000-000000000201",
  firstDraft: "00000000-0000-4000-8000-000000000202",
  badSeries: "00000000-0000-4000-8000-000000000301",
  retrySeries: "00000000-0000-4000-8000-000000000302",
  attentionSeries: "00000000-0000-4000-8000-000000000303",
  assignedSeries: "00000000-0000-4000-8000-000000000304",
  badItem: "00000000-0000-4000-8000-000000000401",
  retryItem: "00000000-0000-4000-8000-000000000402",
  attentionItem: "00000000-0000-4000-8000-000000000403",
  assignedItem: "00000000-0000-4000-8000-000000000404",
  targetedStudent: "00000000-0000-4000-8000-000000000010",
  targetedPeerStudent: "00000000-0000-4000-8000-000000000011",
  targetedExpiredAttempt: "00000000-0000-4000-8000-000000000108",
  targetedPeerAttempt: "00000000-0000-4000-8000-000000000109",
  targetedNewAttempt: "00000000-0000-4000-8000-000000000110",
  targetedAssignment: "00000000-0000-4000-8000-000000000501",
} as const;

type MaintenanceResult = {
  jobName: string;
  processedCount: number;
  failedCount: number;
  attentionCount: number;
  pendingCount: number;
  pendingCountIsLowerBound: boolean;
  oldestDueAt: string | null;
};

async function expectPostgresError(
  operation: Promise<unknown>,
  code: string,
  messageFragment: string,
) {
  try {
    await operation;
    throw new Error("expected PostgreSQL operation to fail");
  } catch (error) {
    expect(error).toMatchObject({ code });
    expect((error as Error).message).toContain(messageFragment);
  }
}

describe.sequential("read-side maintenance jobs", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema auth;
      create schema private;
      create schema cron;

      create function auth.role()
      returns text
      language sql
      stable
      set search_path = ''
      as $$
        select nullif(
          current_setting('request.jwt.claim.role', true),
          ''
        );
      $$;

      create function auth.jwt()
      returns jsonb
      language sql
      stable
      set search_path = ''
      as $$
        select coalesce(
          nullif(current_setting('request.jwt.claims', true), ''),
          '{}'
        )::jsonb;
      $$;

      create table cron.job (
        jobid bigint generated always as identity primary key,
        jobname text not null unique,
        schedule text not null,
        command text not null
      );
      create function cron.schedule(
        p_jobname text,
        p_schedule text,
        p_command text
      )
      returns bigint
      language plpgsql
      as $$
      declare
        scheduled_job_id bigint;
      begin
        insert into cron.job (jobname, schedule, command)
        values (p_jobname, p_schedule, p_command)
        on conflict (jobname) do update
        set schedule = excluded.schedule,
            command = excluded.command
        returning jobid into scheduled_job_id;
        return scheduled_job_id;
      end;
      $$;

      create table public.students (
        id uuid primary key,
        status text not null default 'active',
        deleted_at timestamptz
      );
      create table public.quiz_attempts (
        id uuid primary key,
        student_id uuid not null,
        assignment_id uuid,
        status text not null,
        phase text not null,
        started_at timestamptz not null default transaction_timestamp(),
        initial_completed_at timestamptz,
        retry_started_at timestamptz,
        deadline_at timestamptz not null,
        completed_at timestamptz,
        initial_correct_count integer,
        retry_correct_count integer,
        unresolved_wrong_count integer,
        initial_score numeric(5,2),
        final_score numeric(5,2),
        passed boolean,
        elapsed_seconds integer
      );
      create unique index quiz_attempts_one_in_progress_idx
      on public.quiz_attempts(student_id, assignment_id)
      where status = 'in_progress';
      create table public.quiz_questions (
        id uuid primary key,
        attempt_id uuid not null,
        vocab_entry_id bigint not null,
        initial_choice_index smallint,
        initial_is_correct boolean,
        initial_answered_at timestamptz,
        initial_timed_out boolean,
        retry_choice_index smallint,
        retry_is_correct boolean,
        retry_answered_at timestamptz,
        retry_timed_out boolean
      );
      create table public.student_vocab_state (
        student_id uuid not null,
        vocab_entry_id bigint not null,
        unresolved_wrong_count integer not null,
        last_wrong_at timestamptz,
        resolved_at timestamptz,
        last_attempt_id uuid,
        last_evaluated_at timestamptz not null,
        primary key (student_id, vocab_entry_id)
      );
      create table public.student_vocab_review_assignment_drafts (
        id uuid primary key,
        student_id uuid not null,
        status text not null,
        expires_at timestamptz not null,
        expired_at timestamptz
      );
      create table public.student_vocab_review_queue (
        id uuid primary key,
        student_id uuid not null,
        status text not null,
        reserved_review_draft_id uuid,
        reserved_at timestamptz
      );
      create table public.audit_events (
        id bigint generated always as identity primary key,
        event_type text not null,
        student_id uuid,
        details jsonb not null
      );
    `);

    await database.exec(stateAndFinalizerMigration);
    await database.exec(retryStudentIndexMigration);
    await database.exec(`
      create table private.maintenance_call_log (
        id bigint generated always as identity primary key,
        job_kind text not null,
        target_id uuid not null,
        called_at timestamptz not null default clock_timestamp()
      );

      create or replace function private.finalize_expired_quiz_attempt_at_v2(
        p_student_id uuid,
        p_attempt_id uuid,
        p_evaluation_at timestamptz
      )
      returns jsonb
      language plpgsql
      set search_path = ''
      as $$
      begin
        if p_attempt_id = '${ids.badAttempt}'::uuid then
          raise exception 'fixture_attempt_failure' using errcode = 'P0001';
        end if;
        insert into private.maintenance_call_log (job_kind, target_id)
        values ('attempt', p_attempt_id);
        update public.quiz_attempts
        set status = 'expired', phase = 'completed', completed_at = p_evaluation_at
        where id = p_attempt_id
          and student_id = p_student_id
          and status = 'in_progress';
        return jsonb_build_object('completed', true, 'expired', true);
      end;
      $$;

      create or replace function
        private.finalize_expired_review_assignment_drafts_at_v2(
          p_student_id uuid,
          p_limit integer,
          p_evaluation_at timestamptz
        )
      returns integer
      language plpgsql
      set search_path = ''
      as $$
      declare
        finalized_count integer;
      begin
        if p_student_id = '${ids.badStudent}'::uuid then
          raise exception 'fixture_draft_failure' using errcode = 'P0001';
        end if;
        with candidates as (
          select draft.id
          from public.student_vocab_review_assignment_drafts as draft
          where draft.student_id = p_student_id
            and draft.status = 'pending'
            and draft.expires_at <= p_evaluation_at
          order by draft.expires_at, draft.id
          limit p_limit
        ), expired as (
          update public.student_vocab_review_assignment_drafts as draft
          set status = 'expired', expired_at = p_evaluation_at
          where draft.id in (select candidate.id from candidates as candidate)
          returning draft.id
        )
        select count(*)::integer into finalized_count from expired;
        return finalized_count;
      end;
      $$;

      create or replace function
        private.finalize_expired_review_assignment_draft_at_v1(
          p_student_id uuid,
          p_draft_id uuid,
          p_evaluation_at timestamptz
        )
      returns boolean
      language plpgsql
      set search_path = ''
      as $$
      begin
        if p_draft_id = '${ids.badDraft}'::uuid then
          raise exception 'fixture_draft_failure' using errcode = 'P0001';
        end if;
        update public.student_vocab_review_assignment_drafts as draft
        set status = 'expired', expired_at = p_evaluation_at
        where draft.id = p_draft_id
          and draft.student_id = p_student_id
          and draft.status = 'pending'
          and draft.expires_at <= p_evaluation_at;
        return found;
      end;
      $$;

      create table private.vocab_assignment_series (
        id uuid primary key,
        student_id uuid not null,
        status text not null
      );
      create table private.vocab_assignment_series_items (
        id uuid primary key,
        series_id uuid not null,
        status text not null,
        sequence_number integer not null default 1,
        effective_available_from timestamptz not null
      );

      create or replace function private.materialize_ready_vocab_assignment_queue_v2(
        p_student_id uuid,
        p_limit integer,
        p_evaluation_at timestamptz,
        p_only_item_id uuid default null
      )
      returns jsonb
      language plpgsql
      set search_path = ''
      as $$
      declare
        selected_item_id uuid;
        selected_series_id uuid;
      begin
        select item.id, series.id
        into selected_item_id, selected_series_id
        from private.vocab_assignment_series as series
        join private.vocab_assignment_series_items as item
          on item.series_id = series.id
        where series.student_id = p_student_id
          and series.status = 'active'
          and item.status = 'ready'
          and (p_only_item_id is null or item.id = p_only_item_id)
        order by item.effective_available_from, item.sequence_number, item.id
        limit least(p_limit, 1);
        if selected_item_id is null then
          return '[]'::jsonb;
        end if;
        insert into private.maintenance_call_log (job_kind, target_id)
        values ('queue', p_student_id);

        if selected_item_id = '${ids.badItem}'::uuid then
          raise exception 'fixture_queue_failure' using errcode = 'P0001';
        end if;
        if selected_item_id = '${ids.retryItem}'::uuid then
          return jsonb_build_array(jsonb_build_object(
            'item_id', selected_item_id,
            'status', 'ready'
          ));
        end if;
        if selected_item_id = '${ids.attentionItem}'::uuid then
          update private.vocab_assignment_series_items
          set status = 'attention'
          where id = selected_item_id;
          update private.vocab_assignment_series
          set status = 'attention'
          where id = selected_series_id;
          return jsonb_build_array(jsonb_build_object(
            'item_id', selected_item_id,
            'status', 'attention'
          ));
        end if;

        update private.vocab_assignment_series_items
        set status = 'assigned'
        where id = selected_item_id;
        return jsonb_build_array(jsonb_build_object(
          'item_id', selected_item_id,
          'status', 'assigned'
        ));
      end;
      $$;
    `);

    await database.exec(workerMigration);
    await database.exec(
      scheduleMigration.replace("create extension if not exists pg_cron;", ""),
    );
  }, 20_000);

  afterAll(async () => {
    await database.close();
  });

  afterEach(async () => {
    await database.exec(`
      reset role;
      select set_config('request.jwt.claims', '{}', false);
    `);
  });

  it("keeps worker creation separate from cron activation", async () => {
    for (const migrationName of bodyMigrationNames) {
      expect(migrationName.localeCompare(scheduleMigrationName)).toBeLessThan(0);
      expect(readMigration(migrationName)).not.toContain("cron.schedule");
    }
    expect(scheduleMigration).toContain("cron.schedule");
    expect(scheduleMigration).not.toMatch(/https?:|net\.http|after\s*\(/i);
    expect(scheduleMigration).not.toMatch(
      /\bcreate\s+(?:or replace\s+)?function\b|\bcreate\s+(?:unique\s+)?index\b|\balter\s+table\b/i,
    );

    await database.exec(
      scheduleMigration.replace("create extension if not exists pg_cron;", ""),
    );

    const jobs = await database.query<{
      jobname: string;
      schedule: string;
      command: string;
    }>(`
      select jobname, schedule, command
      from cron.job
      order by jobname;
    `);
    expect(jobs.rows.map((job) => [job.jobname, job.schedule])).toEqual([
      ["english-academy-expire-review-drafts", "*/2 * * * *"],
      ["english-academy-finalize-stale-attempts", "* * * * *"],
      ["english-academy-materialize-ready-vocab-queues", "* * * * *"],
    ]);
    expect(jobs.rows.every((job) => job.command.includes("private."))).toBe(
      true,
    );
  });

  it("keeps a student-leading index for retry cleanup and foreign-key work", async () => {
    const indexes = await database.query<{ indexdef: string }>(`
      select indexdef
      from pg_indexes
      where schemaname = 'private'
        and tablename = 'student_app_maintenance_retry_state'
        and indexname = 'student_app_maintenance_retry_student_idx';
    `);

    expect(indexes.rows).toHaveLength(1);
    expect(indexes.rows[0]?.indexdef).toMatch(/\(student_id\)$/i);
  });

  it("대상 만료 응시만 정리한 뒤 같은 배정의 새 응시 슬롯을 연다", async () => {
    await database.exec(`
      insert into public.students (id) values
        ('${ids.targetedStudent}'),
        ('${ids.targetedPeerStudent}');
      insert into public.quiz_attempts (
        id, student_id, assignment_id, status, phase, deadline_at
      ) values
        (
          '${ids.targetedExpiredAttempt}',
          '${ids.targetedStudent}',
          '${ids.targetedAssignment}',
          'in_progress',
          'initial',
          transaction_timestamp() - interval '1 minute'
        ),
        (
          '${ids.targetedPeerAttempt}',
          '${ids.targetedPeerStudent}',
          '${ids.targetedAssignment}',
          'in_progress',
          'initial',
          transaction_timestamp() + interval '10 minutes'
        );
      select set_config(
        'request.jwt.claims',
        '{"role":"service_role"}',
        false
      );
      set role service_role;
    `);
    const finalized = await database.query<{ finalized: boolean }>(`
      select public.finalize_quiz_attempt_if_stale(
        '${ids.targetedExpiredAttempt}'::uuid
      ) as finalized;
    `);
    await database.exec(`
      reset role;
      insert into public.quiz_attempts (
        id, student_id, assignment_id, status, phase, deadline_at
      ) values (
        '${ids.targetedNewAttempt}',
        '${ids.targetedStudent}',
        '${ids.targetedAssignment}',
        'in_progress',
        'initial',
        transaction_timestamp() + interval '10 minutes'
      );
    `);
    const attempts = await database.query<{
      id: string;
      status: string;
    }>(`
      select id::text, status
      from public.quiz_attempts
      where id in (
        '${ids.targetedExpiredAttempt}'::uuid,
        '${ids.targetedPeerAttempt}'::uuid,
        '${ids.targetedNewAttempt}'::uuid
      )
      order by id;
    `);

    expect(finalized.rows).toEqual([{ finalized: true }]);
    expect(attempts.rows).toEqual([
      { id: ids.targetedExpiredAttempt, status: "expired" },
      { id: ids.targetedPeerAttempt, status: "in_progress" },
      { id: ids.targetedNewAttempt, status: "in_progress" },
    ]);
  });

  it("backs off only the broken attempt so the same student's next attempt runs", async () => {
    await database.exec(`
      insert into public.students (id) values
        ('${ids.badStudent}'),
        ('${ids.firstStudent}'),
        ('${ids.orderedStudent}');
      insert into public.quiz_attempts (
        id, student_id, status, phase, deadline_at
      ) values
        ('${ids.badAttempt}', '${ids.badStudent}', 'in_progress', 'initial',
          transaction_timestamp() - interval '4 minutes'),
        ('${ids.firstAttempt}', '${ids.badStudent}', 'in_progress', 'initial',
          transaction_timestamp() - interval '3 minutes');
    `);

    const firstRun = await database.query<{ result: MaintenanceResult }>(`
      select private.run_stale_quiz_attempt_maintenance_v1(1, 1, 10)
        as result;
    `);
    expect(firstRun.rows[0]?.result).toMatchObject({
      processedCount: 0,
      failedCount: 1,
      pendingCount: 2,
    });

    const secondRun = await database.query<{ result: MaintenanceResult }>(`
      select private.run_stale_quiz_attempt_maintenance_v1(1, 1, 10)
        as result;
    `);
    expect(secondRun.rows[0]?.result).toMatchObject({
      processedCount: 1,
      failedCount: 0,
      pendingCount: 1,
    });
    const attempts = await database.query<{ id: string; status: string }>(`
      select id, status
      from public.quiz_attempts
      where id in ('${ids.badAttempt}', '${ids.firstAttempt}')
      order by id;
    `);
    expect(attempts.rows).toEqual([
      { id: ids.badAttempt, status: "in_progress" },
      { id: ids.firstAttempt, status: "expired" },
    ]);
    const retryTarget = await database.query<{
      student_id: string;
      target_id: string;
      target_kind: string;
    }>(`
      select student_id, target_id, target_kind
      from private.student_app_maintenance_retry_state
      where job_name = 'english-academy-finalize-stale-attempts';
    `);
    expect(retryTarget.rows).toEqual([{
      student_id: ids.badStudent,
      target_id: ids.badAttempt,
      target_kind: "quiz_attempt",
    }]);
  });

  it("processes one student's stale attempts in deadline order", async () => {
    await database.exec(`
      insert into public.students (id)
      values ('${ids.orderedStudent}')
      on conflict (id) do nothing;

      insert into public.quiz_attempts (
        id, student_id, status, phase, deadline_at
      ) values
        ('${ids.orderedSecondAttempt}', '${ids.orderedStudent}',
          'in_progress', 'initial', transaction_timestamp() - interval '1 minute'),
        ('${ids.orderedFirstAttempt}', '${ids.orderedStudent}',
          'in_progress', 'initial', transaction_timestamp() - interval '2 minutes');
    `);
    const result = await database.query<{ result: MaintenanceResult }>(`
      select private.run_stale_quiz_attempt_maintenance_v1(1, 2, 10)
        as result;
    `);
    expect(result.rows[0]?.result.processedCount).toBe(2);
    const order = await database.query<{ target_id: string }>(`
      select target_id
      from private.maintenance_call_log
      where job_kind = 'attempt'
        and target_id in (
          '${ids.orderedFirstAttempt}',
          '${ids.orderedSecondAttempt}'
        )
      order by id;
    `);
    expect(order.rows.map((row) => row.target_id)).toEqual([
      ids.orderedFirstAttempt,
      ids.orderedSecondAttempt,
    ]);
  });

  it("moves a permanent stale failure to operator attention", async () => {
    await database.exec(`
      insert into public.students (id)
      values ('${ids.badStudent}')
      on conflict (id) do update
      set status = 'active', deleted_at = null;

      insert into public.quiz_attempts (
        id, student_id, status, phase, deadline_at
      ) values (
        '${ids.badAttempt}', '${ids.badStudent}', 'in_progress', 'initial',
        transaction_timestamp() - interval '100 minutes'
      )
      on conflict (id) do update
      set status = 'in_progress',
          phase = 'initial',
          deadline_at = excluded.deadline_at,
          completed_at = null;

      delete from private.student_app_maintenance_retry_state
      where job_name = 'english-academy-finalize-stale-attempts'
        and target_id = '${ids.badAttempt}';
    `);

    for (let failure = 1; failure <= 5; failure += 1) {
      if (failure > 1) {
        await database.exec(`
          update private.student_app_maintenance_retry_state
          set next_retry_at = transaction_timestamp() - interval '1 second'
          where job_name = 'english-academy-finalize-stale-attempts'
            and target_id = '${ids.badAttempt}'
            and not requires_attention;
        `);
      }
      const run = await database.query<{ result: MaintenanceResult }>(`
        select private.run_stale_quiz_attempt_maintenance_v1(1, 1, 10)
          as result;
      `);
      expect(run.rows[0]?.result.failedCount).toBe(1);
    }
    const retry = await database.query<{
      consecutive_failures: number;
      next_retry_at: string | null;
      requires_attention: boolean;
      student_id: string;
      target_kind: string;
    }>(`
      select consecutive_failures, next_retry_at, requires_attention,
        student_id, target_kind
      from private.student_app_maintenance_retry_state
      where job_name = 'english-academy-finalize-stale-attempts'
        and target_id = '${ids.badAttempt}';
    `);
    expect(retry.rows).toEqual([{
      consecutive_failures: 5,
      next_retry_at: null,
      requires_attention: true,
      student_id: ids.badStudent,
      target_kind: "quiz_attempt",
    }]);
  });

  it("counts a failed draft against the limit and expires the same student's next draft", async () => {
    await database.exec(`
      insert into public.students (id) values
        ('${ids.badStudent}'),
        ('${ids.firstStudent}')
      on conflict (id) do nothing;

      insert into public.student_vocab_review_assignment_drafts (
        id, student_id, status, expires_at
      ) values
        ('${ids.badDraft}', '${ids.badStudent}', 'pending',
          transaction_timestamp() - interval '4 minutes'),
        ('${ids.firstDraft}', '${ids.badStudent}', 'pending',
          transaction_timestamp() - interval '3 minutes');
    `);
    const firstRun = await database.query<{ result: MaintenanceResult }>(`
      select private.run_expired_review_draft_maintenance_v1(1, 1, 1, 10)
        as result;
    `);
    expect(firstRun.rows[0]?.result).toMatchObject({
      processedCount: 0,
      failedCount: 1,
      pendingCount: 2,
    });
    const afterFirstRun = await database.query<{ status: string }>(`
      select status
      from public.student_vocab_review_assignment_drafts
      where id = '${ids.firstDraft}';
    `);
    expect(afterFirstRun.rows).toEqual([{ status: "pending" }]);

    const secondRun = await database.query<{ result: MaintenanceResult }>(`
      select private.run_expired_review_draft_maintenance_v1(1, 1, 1, 10)
        as result;
    `);
    expect(secondRun.rows[0]?.result).toMatchObject({
      processedCount: 1,
      failedCount: 0,
      pendingCount: 1,
    });
    const drafts = await database.query<{ id: string; status: string }>(`
      select id, status
      from public.student_vocab_review_assignment_drafts
      where id in ('${ids.badDraft}', '${ids.firstDraft}')
      order by id;
    `);
    expect(drafts.rows).toEqual([
      { id: ids.badDraft, status: "pending" },
      { id: ids.firstDraft, status: "expired" },
    ]);
    const retryTarget = await database.query<{
      student_id: string;
      target_id: string;
      target_kind: string;
    }>(`
      select student_id, target_id, target_kind
      from private.student_app_maintenance_retry_state
      where job_name = 'english-academy-expire-review-drafts';
    `);
    expect(retryTarget.rows).toEqual([{
      student_id: ids.badStudent,
      target_id: ids.badDraft,
      target_kind: "review_draft",
    }]);
  });

  it("counts queue attention and does not repeat a retryable item every minute", async () => {
    await database.exec(`
      insert into public.students (id) values
        ('${ids.badStudent}'),
        ('${ids.retryStudent}'),
        ('${ids.attentionStudent}'),
        ('${ids.assignedStudent}')
      on conflict (id) do nothing;
      insert into private.vocab_assignment_series (id, student_id, status) values
        ('${ids.badSeries}', '${ids.badStudent}', 'active'),
        ('${ids.retrySeries}', '${ids.retryStudent}', 'active'),
        ('${ids.attentionSeries}', '${ids.attentionStudent}', 'active'),
        ('${ids.assignedSeries}', '${ids.badStudent}', 'active');
      insert into private.vocab_assignment_series_items (
        id, series_id, status, effective_available_from
      ) values
        ('${ids.badItem}', '${ids.badSeries}', 'ready',
          transaction_timestamp() - interval '4 minutes'),
        ('${ids.retryItem}', '${ids.retrySeries}', 'ready',
          transaction_timestamp() - interval '3 minutes'),
        ('${ids.attentionItem}', '${ids.attentionSeries}', 'ready',
          transaction_timestamp() - interval '2 minutes'),
        ('${ids.assignedItem}', '${ids.assignedSeries}', 'ready',
          transaction_timestamp() - interval '1 minute');
    `);
    const firstRun = await database.query<{ result: MaintenanceResult }>(`
      select private.run_ready_vocab_queue_maintenance_v1(4, 10) as result;
    `);
    expect(firstRun.rows[0]?.result).toMatchObject({
      processedCount: 2,
      failedCount: 2,
      attentionCount: 1,
      pendingCount: 2,
    });
    const queueState = await database.query<{ id: string; status: string }>(`
      select id, status
      from private.vocab_assignment_series_items
      where id in (
        '${ids.badItem}',
        '${ids.retryItem}',
        '${ids.attentionItem}',
        '${ids.assignedItem}'
      )
      order by id;
    `);
    expect(queueState.rows).toEqual([
      { id: ids.badItem, status: "ready" },
      { id: ids.retryItem, status: "ready" },
      { id: ids.attentionItem, status: "attention" },
      { id: ids.assignedItem, status: "assigned" },
    ]);
    const retryTargets = await database.query<{
      student_id: string;
      target_id: string;
      target_kind: string;
    }>(`
      select student_id, target_id, target_kind
      from private.student_app_maintenance_retry_state
      where job_name = 'english-academy-materialize-ready-vocab-queues'
      order by target_id;
    `);
    expect(retryTargets.rows).toEqual([
      {
        student_id: ids.badStudent,
        target_id: ids.badItem,
        target_kind: "vocab_series_item",
      },
      {
        student_id: ids.retryStudent,
        target_id: ids.retryItem,
        target_kind: "vocab_series_item",
      },
    ]);

    const retryCallsBefore = await database.query<{ count: number }>(`
      select count(*)::integer as count
      from private.maintenance_call_log
      where job_kind = 'queue'
        and target_id = '${ids.retryStudent}';
    `);
    const secondRun = await database.query<{ result: MaintenanceResult }>(`
      select private.run_ready_vocab_queue_maintenance_v1(4, 10) as result;
    `);
    const retryCallsAfter = await database.query<{ count: number }>(`
      select count(*)::integer as count
      from private.maintenance_call_log
      where job_kind = 'queue'
        and target_id = '${ids.retryStudent}';
    `);
    expect(secondRun.rows[0]?.result).toMatchObject({
      processedCount: 0,
      failedCount: 0,
      attentionCount: 1,
      pendingCount: 2,
    });
    expect(retryCallsAfter.rows).toEqual(retryCallsBefore.rows);
  });

  it("caps backlog probes and records the oldest remaining due item", async () => {
    await database.exec(`
      update public.quiz_attempts
      set status = 'expired', phase = 'completed'
      where status = 'in_progress';

      delete from private.student_app_maintenance_retry_state
      where job_name = 'english-academy-finalize-stale-attempts';

      insert into public.students (id) values
        ('${ids.backlogFirstStudent}'),
        ('${ids.backlogSecondStudent}'),
        ('${ids.backlogThirdStudent}')
      on conflict (id) do nothing;

      insert into public.quiz_attempts (
        id, student_id, status, phase, deadline_at
      ) values
        ('${ids.backlogFirstAttempt}', '${ids.backlogFirstStudent}',
          'in_progress', 'initial', transaction_timestamp() - interval '10 minutes'),
        ('${ids.backlogSecondAttempt}', '${ids.backlogSecondStudent}',
          'in_progress', 'initial', transaction_timestamp() - interval '9 minutes'),
        ('${ids.backlogThirdAttempt}', '${ids.backlogThirdStudent}',
          'in_progress', 'initial', transaction_timestamp() - interval '8 minutes');
    `);

    const run = await database.query<{ result: MaintenanceResult }>(`
      select private.run_stale_quiz_attempt_maintenance_v1(1, 1, 1)
        as result;
    `);
    expect(run.rows[0]?.result).toMatchObject({
      processedCount: 1,
      failedCount: 0,
      attentionCount: 0,
      pendingCount: 1,
      pendingCountIsLowerBound: true,
    });
    expect(run.rows[0]?.result.oldestDueAt).not.toBeNull();

    const expected = await database.query<{ oldest_due_epoch: number }>(`
      select extract(epoch from min(deadline_at))::double precision
        as oldest_due_epoch
      from public.quiz_attempts
      where status = 'in_progress'
        and phase in ('initial', 'retry')
        and deadline_at <= transaction_timestamp();
    `);
    const state = await database.query<{
      attention_count: number;
      consecutive_failed_runs: number;
      failed_count: number;
      has_completed_at: boolean;
      has_started_at: boolean;
      last_error_code: string | null;
      oldest_due_epoch: number;
      pending_count: number;
      pending_count_is_lower_bound: boolean;
      processed_count: number;
    }>(`
      select
        processed_count,
        failed_count,
        attention_count,
        pending_count,
        pending_count_is_lower_bound,
        extract(epoch from oldest_due_at)::double precision as oldest_due_epoch,
        consecutive_failed_runs,
        last_error_code,
        last_started_at is not null as has_started_at,
        last_completed_at is not null as has_completed_at
      from private.student_app_maintenance_state
      where job_name = 'english-academy-finalize-stale-attempts';
    `);
    expect(state.rows).toEqual([{
      processed_count: 1,
      failed_count: 0,
      attention_count: 0,
      pending_count: 1,
      pending_count_is_lower_bound: true,
      oldest_due_epoch: expected.rows[0]!.oldest_due_epoch,
      consecutive_failed_runs: 0,
      last_error_code: null,
      has_started_at: true,
      has_completed_at: true,
    }]);
  });

  it("keeps workers private and checks the status caller inside the function", async () => {
    const privileges = await database.query<{
      can_execute: boolean;
      function_kind: string;
      function_name: string;
      role_name: string;
    }>(`
      with role_names(role_name) as (
        values ('anon'), ('authenticated'), ('service_role')
      ), function_names(function_kind, function_name) as (
        values
          ('private', 'private.run_stale_quiz_attempt_maintenance_v1(integer,integer,integer)'),
          ('private', 'private.run_expired_review_draft_maintenance_v1(integer,integer,integer,integer)'),
          ('private', 'private.run_ready_vocab_queue_maintenance_v1(integer,integer)'),
          ('public', 'public.finalize_stale_quiz_attempts(integer)'),
          ('public', 'public.finalize_quiz_attempt_if_stale(uuid)'),
          ('public', 'public.finalize_expired_review_assignment_drafts(uuid,integer)'),
          ('public', 'public.materialize_ready_vocab_assignment_queue_v1(uuid,integer)'),
          ('public', 'public.get_student_app_maintenance_status_v1()')
      )
      select
        role_names.role_name,
        function_names.function_kind,
        function_names.function_name,
        has_function_privilege(
          role_names.role_name,
          function_names.function_name,
          'execute'
        ) as can_execute
      from role_names
      cross join function_names
      order by function_names.function_kind, function_names.function_name,
        role_names.role_name;
    `);
    expect(
      privileges.rows
        .filter((row) => row.function_kind === "private")
        .every((row) => !row.can_execute),
    ).toBe(true);
    expect(
      privileges.rows
        .filter((row) => row.function_kind === "public")
        .every((row) =>
          row.can_execute === (row.role_name === "service_role")),
    ).toBe(true);

    await database.exec(`
      select private.run_stale_quiz_attempt_maintenance_v1(10, 10, 1);
      select private.run_expired_review_draft_maintenance_v1(10, 10, 10, 1);
      select private.run_ready_vocab_queue_maintenance_v1(10, 1);
    `);

    await database.exec(`
      select set_config('request.jwt.claims', '{"role":"anon"}', false);
      set role anon;
    `);
    await expectPostgresError(
      database.query("select * from public.get_student_app_maintenance_status_v1()"),
      "42501",
      "permission denied",
    );
    await database.exec(`
      reset role;
      select set_config(
        'request.jwt.claims',
        '{"role":"authenticated"}',
        false
      );
      set role authenticated;
    `);
    await expectPostgresError(
      database.query("select * from public.get_student_app_maintenance_status_v1()"),
      "42501",
      "permission denied",
    );
    await database.exec(`
      reset role;
      select set_config(
        'request.jwt.claims',
        '{"role":"service_role"}',
        false
      );
      set role anon;
    `);
    await expectPostgresError(
      database.query("select * from public.get_student_app_maintenance_status_v1()"),
      "42501",
      "permission denied",
    );
    await database.exec(`
      reset role;
      select set_config('request.jwt.claims', '{"role":"anon"}', false);
      set role service_role;
    `);
    await expectPostgresError(
      database.query("select * from public.get_student_app_maintenance_status_v1()"),
      "42501",
      "forbidden",
    );
    await database.exec(`
      reset role;
      select set_config(
        'request.jwt.claims',
        '{"role":"service_role"}',
        false
      );
      set role service_role;
    `);
    const status = await database.query<{
      has_completed_at: boolean;
      has_started_at: boolean;
      has_updated_at: boolean;
      job_name: string;
      non_negative_counts: boolean;
      oldest_matches_pending: boolean;
      pending_count_is_lower_bound: boolean;
    }>(`
      select
        job_name,
        last_started_at is not null as has_started_at,
        last_completed_at is not null as has_completed_at,
        (oldest_due_at is not null) = (pending_count > 0)
          as oldest_matches_pending,
        updated_at is not null as has_updated_at,
        processed_count >= 0
          and failed_count >= 0
          and attention_count >= 0
          and pending_count >= 0
          and consecutive_failed_runs >= 0 as non_negative_counts,
        pending_count_is_lower_bound
      from public.get_student_app_maintenance_status_v1()
      order by job_name;
    `);
    const publicCalls = await database.query<{
      draft_count: number;
      missing_attempt_finalized: boolean;
      queue_result: unknown[];
    }>(`
      select
        public.finalize_quiz_attempt_if_stale(
          '00000000-0000-4000-8000-000000009999'::uuid
        ) as missing_attempt_finalized,
        public.finalize_expired_review_assignment_drafts(
          '00000000-0000-4000-8000-000000009999'::uuid,
          10
        ) as draft_count,
        public.materialize_ready_vocab_assignment_queue_v1(
          '00000000-0000-4000-8000-000000009999'::uuid,
          10
        ) as queue_result;
    `);
    await database.exec(`
      reset role;
      select set_config('request.jwt.claims', '{"role":"anon"}', false);
    `);

    expect(status.rows).toHaveLength(3);
    expect(status.rows.every((row) => row.has_started_at)).toBe(true);
    expect(status.rows.every((row) => row.has_completed_at)).toBe(true);
    expect(status.rows.every((row) => row.has_updated_at)).toBe(true);
    expect(status.rows.every((row) => row.oldest_matches_pending)).toBe(true);
    expect(status.rows.every((row) => row.non_negative_counts)).toBe(true);
    expect(
      status.rows.every(
        (row) => typeof row.pending_count_is_lower_bound === "boolean",
      ),
    ).toBe(true);
    expect(publicCalls.rows).toEqual([{
      missing_attempt_finalized: false,
      draft_count: 0,
      queue_result: [],
    }]);
  });

  it("rejects invalid worker limits", async () => {
    await expectPostgresError(
      database.query(
        "select private.run_stale_quiz_attempt_maintenance_v1(0, 1, 10)",
      ),
      "22023",
      "invalid_stale_attempt_maintenance_limit",
    );
    await expectPostgresError(
      database.query(
        "select private.run_ready_vocab_queue_maintenance_v1(11, 10)",
      ),
      "22023",
      "invalid_vocab_queue_maintenance_limit",
    );
  });
});
