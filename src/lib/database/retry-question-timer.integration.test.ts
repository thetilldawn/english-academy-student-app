import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260811090000_reset_retry_question_timer.sql",
  ),
  "utf8",
);

const ids = {
  attempt: "00000000-0000-4000-8000-000000000101",
  correctQuestion: "00000000-0000-4000-8000-000000000202",
  student: "00000000-0000-4000-8000-000000000001",
  wrongQuestion: "00000000-0000-4000-8000-000000000201",
} as const;

describe.sequential("retry question timer migration", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema private;

      create table public.quiz_attempts (
        id uuid primary key,
        student_id uuid not null,
        status text not null,
        phase text not null,
        deadline_at timestamptz not null,
        time_limit_seconds_snapshot integer not null,
        retry_started_at timestamptz,
        current_question_started_at timestamptz not null
      );

      create table public.quiz_questions (
        id uuid primary key,
        attempt_id uuid not null references public.quiz_attempts(id),
        order_index integer not null,
        initial_choice_index smallint,
        initial_is_correct boolean,
        retry_choice_index smallint
      );

      grant usage on schema public to service_role;
      grant select, update on public.quiz_attempts to service_role;
      grant select on public.quiz_questions to service_role;

      create function private.reset_question_clock_on_retry()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $$
      begin
        if new.phase = 'retry' and old.phase is distinct from new.phase then
          new.current_question_started_at := clock_timestamp();
        end if;
        return new;
      end;
      $$;

      create trigger quiz_attempts_reset_question_clock_on_retry
      before update of phase on public.quiz_attempts
      for each row
      execute function private.reset_question_clock_on_retry();
    `);
    await database.exec(migration);
  }, 20_000);

  afterEach(async () => {
    await database.exec(`
      reset role;
      truncate table public.quiz_questions, public.quiz_attempts;
    `);
  });

  afterAll(async () => {
    await database.close();
  });

  async function seedReviewAttempt() {
    await database.exec(`
      insert into public.quiz_attempts (
        id,
        student_id,
        status,
        phase,
        deadline_at,
        time_limit_seconds_snapshot,
        retry_started_at,
        current_question_started_at
      ) values (
        '${ids.attempt}',
        '${ids.student}',
        'in_progress',
        'review',
        clock_timestamp() + interval '1 hour',
        300,
        null,
        clock_timestamp() - interval '10 minutes'
      );

      insert into public.quiz_questions (
        id,
        attempt_id,
        order_index,
        initial_choice_index,
        initial_is_correct,
        retry_choice_index
      ) values
        ('${ids.wrongQuestion}', '${ids.attempt}', 1, 1, false, null),
        ('${ids.correctQuestion}', '${ids.attempt}', 2, 0, true, null);
    `);
  }

  it("aligns the first retry question clock and does not extend it on reentry", async () => {
    await seedReviewAttempt();
    await database.exec("set role service_role;");

    const started = await database.query<{
      next_question_id: string;
      phase: string;
    }>(`
      select
        result ->> 'phase' as phase,
        result ->> 'nextQuestionId' as next_question_id
      from (
        select public.start_quiz_retry(
          '${ids.student}'::uuid,
          '${ids.attempt}'::uuid
        ) as result
      ) call;
    `);
    expect(started.rows).toEqual([
      { next_question_id: ids.wrongQuestion, phase: "retry" },
    ]);

    const firstClock = await database.query<{
      clocks_aligned: boolean;
      deadline_epoch: number;
      question_epoch: number;
      retry_epoch: number;
      retry_seconds: number;
    }>(`
      select
        retry_started_at = current_question_started_at as clocks_aligned,
        extract(epoch from (deadline_at - retry_started_at))::integer
          as retry_seconds,
        extract(epoch from retry_started_at)::double precision
          as retry_epoch,
        extract(epoch from deadline_at)::double precision
          as deadline_epoch,
        extract(epoch from current_question_started_at)::double precision
          as question_epoch
      from public.quiz_attempts
      where id = '${ids.attempt}';
    `);
    expect(firstClock.rows[0]).toMatchObject({
      clocks_aligned: true,
      retry_seconds: 300,
    });

    await database.query(`
      select public.start_quiz_retry(
        '${ids.student}'::uuid,
        '${ids.attempt}'::uuid
      );
    `);
    const secondClock = await database.query<{
      deadline_epoch: number;
      question_epoch: number;
      retry_epoch: number;
    }>(`
      select
        extract(epoch from retry_started_at)::double precision
          as retry_epoch,
        extract(epoch from deadline_at)::double precision
          as deadline_epoch,
        extract(epoch from current_question_started_at)::double precision
          as question_epoch
      from public.quiz_attempts
      where id = '${ids.attempt}';
    `);
    expect(secondClock.rows[0]).toEqual({
      deadline_epoch: firstClock.rows[0]?.deadline_epoch,
      question_epoch: firstClock.rows[0]?.question_epoch,
      retry_epoch: firstClock.rows[0]?.retry_epoch,
    });
  });

  it("allows only the service role to execute the retry RPC", async () => {
    const privileges = await database.query<{
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(`
      select
        has_function_privilege(
          'anon',
          'public.start_quiz_retry(uuid,uuid)',
          'execute'
        ) as anon,
        has_function_privilege(
          'authenticated',
          'public.start_quiz_retry(uuid,uuid)',
          'execute'
        ) as authenticated,
        has_function_privilege(
          'service_role',
          'public.start_quiz_retry(uuid,uuid)',
          'execute'
        ) as service;
    `);

    expect(privileges.rows[0]).toEqual({
      anon: false,
      authenticated: false,
      service: true,
    });

    const triggerContract = await database.query<{
      definition: string;
      trigger_present: boolean;
    }>(`
      select
        pg_get_functiondef(
          'private.reset_question_clock_on_retry()'::regprocedure
        ) as definition,
        exists (
          select 1
          from pg_trigger
          where tgname = 'quiz_attempts_reset_question_clock_on_retry'
            and not tgisinternal
        ) as trigger_present;
    `);
    expect(triggerContract.rows[0]?.trigger_present).toBe(true);
    expect(triggerContract.rows[0]?.definition).toContain(
      "new.retry_started_at",
    );
  });
});
