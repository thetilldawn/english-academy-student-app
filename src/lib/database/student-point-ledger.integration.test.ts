import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260825083542_add_student_point_ledger.sql",
  ),
  "utf8",
);

const ids = {
  student: "00000000-0000-4000-8000-000000000001",
  dataset: "00000000-0000-4000-8000-000000000002",
  regularAssignment: "00000000-0000-4000-8000-000000000101",
  reviewAssignment: "00000000-0000-4000-8000-000000000102",
  mixedAssignment: "00000000-0000-4000-8000-000000000103",
  regularAttempt: "00000000-0000-4000-8000-000000000201",
  reviewAttempt: "00000000-0000-4000-8000-000000000202",
  mixedAttempt: "00000000-0000-4000-8000-000000000203",
  nullRuleAttempt: "00000000-0000-4000-8000-000000000204",
} as const;

function uuid(suffix: number) {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

describe.sequential("student point ledger", () => {
  let database: PGlite;
  let historicalEventCount = -1;
  let historicalRuleSnapshot: string | null = "not-checked";

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema private;

      create function private.is_active_admin()
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $$
        select coalesce(
          current_setting('app.test_active_admin', true),
          'false'
        ) = 'true'
      $$;

      create table public.students (
        id uuid primary key
      );
      create table public.vocab_datasets (
        id uuid primary key
      );
      create table public.vocab_entries (
        id bigint primary key,
        dataset_id uuid not null,
        headword text not null
      );
      create table public.assignments (
        id uuid primary key,
        dataset_id uuid not null,
        assignment_purpose text not null
      );
      create table public.assignment_questions (
        id uuid primary key,
        assignment_id uuid not null,
        canonical_lexeme_id_snapshot uuid,
        headword_snapshot text
      );
      create table public.assignment_review_targets (
        assignment_id uuid not null,
        student_id uuid not null,
        assignment_question_id uuid not null
      );
      create table public.quiz_attempts (
        id uuid primary key,
        student_id uuid not null,
        assignment_id uuid not null,
        status text not null,
        phase text not null,
        initial_completed_at timestamptz,
        completed_at timestamptz
      );
      create table public.quiz_questions (
        id uuid primary key,
        attempt_id uuid not null,
        vocab_entry_id bigint not null,
        assignment_question_id uuid,
        initial_choice_index smallint,
        initial_is_correct boolean,
        initial_timed_out boolean not null default false,
        initial_answered_at timestamptz,
        retry_choice_index smallint,
        retry_is_correct boolean,
        retry_timed_out boolean not null default false,
        retry_answered_at timestamptz
      );

      insert into public.students (id) values ('${ids.student}');
      insert into public.vocab_datasets (id) values ('${ids.dataset}');
      insert into public.vocab_entries (id, dataset_id, headword)
      values (9, '${ids.dataset}', 'historical-word');
      insert into public.assignments (id, dataset_id, assignment_purpose)
      values ('${ids.regularAssignment}', '${ids.dataset}', 'regular');
      insert into public.assignment_questions (
        id, assignment_id, headword_snapshot
      ) values ('${uuid(409)}', '${ids.regularAssignment}', 'historical-word');
      insert into public.quiz_attempts (
        id, student_id, assignment_id, status, phase
      ) values (
        '${ids.nullRuleAttempt}', '${ids.student}',
        '${ids.regularAssignment}', 'in_progress', 'initial'
      );
      insert into public.quiz_questions (
        id, attempt_id, vocab_entry_id, assignment_question_id,
        initial_choice_index, initial_is_correct, initial_answered_at
      ) values (
        '${uuid(309)}', '${ids.nullRuleAttempt}', 9, '${uuid(409)}',
        0, true, clock_timestamp()
      );
    `);
    await database.exec(migration);
    const historicalAttempt = await database.query<{
      point_rule_version_snapshot: string | null;
    }>(`
      select point_rule_version_snapshot
      from public.quiz_attempts
      where id = '${ids.nullRuleAttempt}';
    `);
    historicalRuleSnapshot =
      historicalAttempt.rows[0]?.point_rule_version_snapshot ?? null;
    await database.exec(`
      update public.quiz_attempts
      set status = 'completed', phase = 'completed',
        completed_at = clock_timestamp()
      where id = '${ids.nullRuleAttempt}';
    `);
    historicalEventCount = (
      await database.query<{ count: number }>(`
        select count(*)::integer as count
        from public.student_point_events;
      `)
    ).rows[0]?.count ?? -1;
  }, 20_000);

  beforeEach(async () => {
    await database.exec(`
      truncate table public.student_point_events,
        public.student_point_totals,
        public.assignment_review_targets,
        public.quiz_questions,
        public.quiz_attempts,
        public.assignment_questions,
        public.assignments,
        public.vocab_entries,
        public.vocab_datasets,
        public.students;

      insert into public.students (id) values ('${ids.student}');
      insert into public.vocab_datasets (id) values ('${ids.dataset}');
      insert into public.vocab_entries (id, dataset_id, headword)
      select value, '${ids.dataset}', 'word-' || value::text
      from generate_series(1, 9) as value;

      insert into public.assignments (id, dataset_id, assignment_purpose)
      values
        ('${ids.regularAssignment}', '${ids.dataset}', 'regular'),
        ('${ids.reviewAssignment}', '${ids.dataset}', 'review'),
        ('${ids.mixedAssignment}', '${ids.dataset}', 'mixed');

      insert into public.assignment_questions (
        id, assignment_id, canonical_lexeme_id_snapshot, headword_snapshot
      )
      select
        (
          '00000000-0000-4000-8000-'
          || lpad((400 + value)::text, 12, '0')
        )::uuid,
        case
          when value <= 3 then '${ids.regularAssignment}'::uuid
          when value <= 6 then '${ids.reviewAssignment}'::uuid
          when value <= 8 then '${ids.mixedAssignment}'::uuid
          else '${ids.regularAssignment}'::uuid
        end,
        (
          '00000000-0000-4000-8000-'
          || lpad((500 + value)::text, 12, '0')
        )::uuid,
        'word-' || value::text
      from generate_series(1, 9) as value;
    `);
  });

  afterAll(async () => {
    await database.close();
  });

  it("keeps historical attempts unversioned and forces new attempts onto v1", async () => {
    expect(historicalRuleSnapshot).toBeNull();
    expect(historicalEventCount).toBe(0);

    await database.exec(`
      insert into public.quiz_attempts (
        id, student_id, assignment_id, status, phase,
        point_rule_version_snapshot
      ) values (
        '${ids.nullRuleAttempt}', '${ids.student}',
        '${ids.regularAssignment}', 'in_progress', 'initial', null
      );
      insert into public.quiz_questions (
        id, attempt_id, vocab_entry_id, assignment_question_id,
        initial_choice_index, initial_is_correct, initial_answered_at
      ) values (
        '${uuid(309)}', '${ids.nullRuleAttempt}', 9, '${uuid(409)}',
        0, true, clock_timestamp()
      );
      update public.quiz_attempts
      set status = 'completed', phase = 'completed',
        completed_at = clock_timestamp()
      where id = '${ids.nullRuleAttempt}';
    `);

    const state = await database.query<{
      count: number;
      point_rule_version_snapshot: string;
    }>(`
      select
        attempt.point_rule_version_snapshot,
        count(event.id)::integer as count
      from public.quiz_attempts as attempt
      left join public.student_point_events as event
        on event.quiz_attempt_id = attempt.id
      where attempt.id = '${ids.nullRuleAttempt}'
      group by attempt.point_rule_version_snapshot;
    `);
    expect(state.rows).toEqual([
      { point_rule_version_snapshot: "vocab-points-v1", count: 1 },
    ]);

    await expect(
      database.exec(`
        update public.quiz_attempts
        set point_rule_version_snapshot = 'vocab-points-v2'
        where id = '${ids.nullRuleAttempt}';
      `),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("records regular, review, mixed, timeout, retry, and zero-point outcomes once", async () => {
    await database.exec(`
      insert into public.quiz_attempts (
        id, student_id, assignment_id, status, phase
      ) values
        ('${ids.regularAttempt}', '${ids.student}', '${ids.regularAssignment}',
          'in_progress', 'initial'),
        ('${ids.reviewAttempt}', '${ids.student}', '${ids.reviewAssignment}',
          'in_progress', 'initial'),
        ('${ids.mixedAttempt}', '${ids.student}', '${ids.mixedAssignment}',
          'in_progress', 'initial');

      insert into public.quiz_questions (
        id, attempt_id, vocab_entry_id, assignment_question_id,
        initial_choice_index, initial_is_correct,
        initial_timed_out, initial_answered_at
      ) values
        ('${uuid(301)}', '${ids.regularAttempt}', 1, '${uuid(401)}',
          0, true, false, clock_timestamp()),
        ('${uuid(302)}', '${ids.regularAttempt}', 2, '${uuid(402)}',
          1, false, false, clock_timestamp()),
        ('${uuid(303)}', '${ids.regularAttempt}', 3, '${uuid(403)}',
          1, false, true, null),
        ('${uuid(304)}', '${ids.reviewAttempt}', 4, '${uuid(404)}',
          0, true, false, clock_timestamp()),
        ('${uuid(305)}', '${ids.reviewAttempt}', 5, '${uuid(405)}',
          null, false, true, null),
        ('${uuid(306)}', '${ids.reviewAttempt}', 6, '${uuid(406)}',
          1, false, false, clock_timestamp()),
        ('${uuid(307)}', '${ids.mixedAttempt}', 7, '${uuid(407)}',
          1, false, false, clock_timestamp()),
        ('${uuid(308)}', '${ids.mixedAttempt}', 8, '${uuid(408)}',
          1, false, false, clock_timestamp());

      insert into public.assignment_review_targets (
        assignment_id, student_id, assignment_question_id
      ) values (
        '${ids.mixedAssignment}', '${ids.student}', '${uuid(408)}'
      );

      update public.quiz_attempts
      set phase = 'review', initial_completed_at = clock_timestamp()
      where id in (
        '${ids.regularAttempt}', '${ids.reviewAttempt}', '${ids.mixedAttempt}'
      );

      update public.quiz_questions
      set retry_is_correct = case id
          when '${uuid(302)}' then true
          when '${uuid(305)}' then true
          else false
        end,
        retry_choice_index = 1,
        retry_answered_at = clock_timestamp()
      where id in (
        '${uuid(302)}', '${uuid(303)}', '${uuid(305)}', '${uuid(306)}'
      );

      update public.quiz_attempts
      set phase = 'retry'
      where id in ('${ids.regularAttempt}', '${ids.reviewAttempt}');

      update public.quiz_attempts
      set status = 'completed', phase = 'completed',
        completed_at = clock_timestamp()
      where id in (
        '${ids.regularAttempt}', '${ids.reviewAttempt}', '${ids.mixedAttempt}'
      );
    `);

    const grouped = await database.query<{
      delta: number;
      exam_kind: string;
      outcome: string;
      stage: string;
    }>(`
      select exam_kind, stage, outcome, delta
      from public.student_point_events
      order by quiz_question_id, stage;
    `);
    expect(grouped.rows).toHaveLength(12);
    expect(grouped.rows).toEqual(
      expect.arrayContaining([
        { exam_kind: "regular", stage: "initial", outcome: "correct", delta: 2 },
        { exam_kind: "regular", stage: "initial", outcome: "wrong", delta: -3 },
        { exam_kind: "regular", stage: "initial", outcome: "timeout", delta: -3 },
        { exam_kind: "regular", stage: "retry", outcome: "correct", delta: 2 },
        { exam_kind: "regular", stage: "retry", outcome: "wrong", delta: 0 },
        { exam_kind: "review", stage: "initial", outcome: "correct", delta: 2 },
        { exam_kind: "review", stage: "initial", outcome: "unanswered", delta: 0 },
        { exam_kind: "review", stage: "initial", outcome: "wrong", delta: 0 },
        { exam_kind: "review", stage: "retry", outcome: "correct", delta: 1 },
        { exam_kind: "review", stage: "retry", outcome: "wrong", delta: 0 },
      ]),
    );

    const mixed = await database.query<{
      delta: number;
      exam_kind: string;
      quiz_question_id: string;
    }>(`
      select quiz_question_id::text, exam_kind, delta
      from public.student_point_events
      where quiz_attempt_id = '${ids.mixedAttempt}'
      order by quiz_question_id;
    `);
    expect(mixed.rows).toEqual([
      { quiz_question_id: uuid(307), exam_kind: "regular", delta: -3 },
      { quiz_question_id: uuid(308), exam_kind: "review", delta: 0 },
    ]);

    const total = await database.query<{
      event_count: number;
      ledger_sum: number;
      total_points: number;
      zero_events: number;
    }>(`
      select
        total.total_points::integer,
        total.event_count::integer,
        (select sum(delta)::integer from public.student_point_events)
          as ledger_sum,
        (select count(*)::integer from public.student_point_events where delta = 0)
          as zero_events
      from public.student_point_totals as total
      where total.student_id = '${ids.student}';
    `);
    expect(total.rows).toEqual([
      { total_points: -2, event_count: 12, ledger_sum: -2, zero_events: 5 },
    ]);

    const duplicateInsertCounts = await database.query<{ inserted: number }>(`
      select private.record_vocab_quiz_point_events(
        attempt.id,
        attempt.student_id,
        attempt.point_rule_version_snapshot,
        attempt.completed_at
      ) as inserted
      from public.quiz_attempts as attempt
      order by attempt.id;
    `);
    expect(duplicateInsertCounts.rows).toEqual([
      { inserted: 0 },
      { inserted: 0 },
      { inserted: 0 },
    ]);

    const totalAfterDuplicate = await database.query<{
      event_count: number;
      total_points: number;
    }>(`
      select total_points::integer, event_count::integer
      from public.student_point_totals
      where student_id = '${ids.student}';
    `);
    expect(totalAfterDuplicate.rows).toEqual([
      { total_points: -2, event_count: 12 },
    ]);
  });

  it("rejects changes to a recorded event", async () => {
    await database.exec(`
      insert into public.quiz_attempts (
        id, student_id, assignment_id, status, phase
      ) values (
        '${ids.regularAttempt}', '${ids.student}', '${ids.regularAssignment}',
        'in_progress', 'initial'
      );
      insert into public.quiz_questions (
        id, attempt_id, vocab_entry_id, assignment_question_id,
        initial_choice_index, initial_is_correct, initial_answered_at
      ) values (
        '${uuid(301)}', '${ids.regularAttempt}', 1, '${uuid(401)}',
        0, true, clock_timestamp()
      );
      update public.quiz_attempts
      set status = 'completed', phase = 'completed',
        completed_at = clock_timestamp()
      where id = '${ids.regularAttempt}';
    `);

    await expect(
      database.exec(`update public.student_point_events set delta = 9;`),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      database.exec(`delete from public.student_point_events;`),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("allows authorized reads without granting direct event writes", async () => {
    await database.exec(`
      insert into public.quiz_attempts (
        id, student_id, assignment_id, status, phase
      ) values (
        '${ids.regularAttempt}', '${ids.student}', '${ids.regularAssignment}',
        'in_progress', 'initial'
      );
      insert into public.quiz_questions (
        id, attempt_id, vocab_entry_id, assignment_question_id,
        initial_choice_index, initial_is_correct, initial_answered_at
      ) values (
        '${uuid(301)}', '${ids.regularAttempt}', 1, '${uuid(401)}',
        0, true, clock_timestamp()
      );
      update public.quiz_attempts
      set status = 'completed', phase = 'completed',
        completed_at = clock_timestamp()
      where id = '${ids.regularAttempt}';
    `);

    await database.exec(`
      select set_config('app.test_active_admin', 'false', false);
      set role authenticated;
    `);
    const hidden = await database.query<{ count: number }>(`
      select count(*)::integer as count from public.student_point_events;
    `);
    expect(hidden.rows).toEqual([{ count: 0 }]);
    await database.exec("reset role;");

    await database.exec(`
      select set_config('app.test_active_admin', 'true', false);
      set role authenticated;
    `);
    const visible = await database.query<{ count: number }>(`
      select count(*)::integer as count from public.student_point_events;
    `);
    expect(visible.rows).toEqual([{ count: 1 }]);
    await expect(
      database.exec(`
        insert into public.student_point_events (
          event_key, event_kind, student_id, rule_version,
          reason_code, delta, occurred_at
        ) values (
          'forbidden-adjustment', 'adjustment', '${ids.student}',
          'manual-v1', 'forbidden_adjustment', 1, clock_timestamp()
        );
      `),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      database.query(`
        select nextval('public.student_point_events_id_seq');
      `),
    ).rejects.toMatchObject({ code: "42501" });
    await database.exec("reset role;");

    await database.exec("set role service_role;");
    const serviceVisible = await database.query<{ count: number }>(`
      select count(*)::integer as count from public.student_point_events;
    `);
    expect(serviceVisible.rows).toEqual([{ count: 1 }]);
    await expect(
      database.exec(`
        insert into public.student_point_events (
          event_key, event_kind, student_id, rule_version,
          reason_code, delta, occurred_at
        ) values (
          'service-adjustment', 'adjustment', '${ids.student}',
          'manual-v1', 'service_adjustment', 1, clock_timestamp()
        );
      `),
    ).rejects.toMatchObject({ code: "42501" });
    await database.exec("reset role;");
  });
});
