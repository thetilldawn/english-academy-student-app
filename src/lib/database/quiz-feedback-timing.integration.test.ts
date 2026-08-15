import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260815113000_extend_quiz_audio_feedback_and_answer_grace.sql",
  ),
  "utf8",
);
const normalRateFeedbackMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260815115000_fit_normal_rate_answer_audio_feedback.sql",
  ),
  "utf8",
);

const ids = {
  assignment: "00000000-0000-4000-8000-000000000101",
  attempt: "00000000-0000-4000-8000-000000000102",
  nextQuestion: "00000000-0000-4000-8000-000000000202",
  question: "00000000-0000-4000-8000-000000000201",
  student: "00000000-0000-4000-8000-000000000001",
} as const;

describe.sequential("quiz feedback timing migration", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;

      create table public.assignments (
        id uuid primary key,
        timing_mode text not null,
        question_time_limit_seconds integer
      );

      create table public.quiz_attempts (
        id uuid primary key,
        student_id uuid not null,
        assignment_id uuid not null references public.assignments(id),
        deadline_at timestamptz not null,
        current_question_started_at timestamptz not null
      );

      create table public.quiz_questions (
        id uuid primary key,
        attempt_id uuid not null references public.quiz_attempts(id),
        correct_choice_index smallint not null,
        initial_timed_out boolean not null default false,
        retry_timed_out boolean not null default false
      );

      create function public.answer_quiz_question(
        p_student_id uuid,
        p_attempt_id uuid,
        p_question_id uuid,
        p_phase text,
        p_choice_index smallint
      )
      returns jsonb
      language sql
      security invoker
      set search_path = ''
      as $$
        select jsonb_build_object(
          'completed', false,
          'correct', p_choice_index = 0,
          'correctChoiceIndex', 0,
          'expired', false,
          'nextQuestionId', '${ids.nextQuestion}',
          'receivedChoice', p_choice_index
        );
      $$;

      grant usage on schema public to service_role;
      grant select on public.assignments to service_role;
      grant select, update on public.quiz_attempts to service_role;
      grant select, update on public.quiz_questions to service_role;
      grant execute on function public.answer_quiz_question(
        uuid, uuid, uuid, text, smallint
      ) to service_role;
    `);
    await database.exec(migration);
    await database.exec(normalRateFeedbackMigration);
  }, 20_000);

  afterEach(async () => {
    await database.exec(`
      reset role;
      truncate table public.quiz_questions, public.quiz_attempts,
        public.assignments;
    `);
  });

  afterAll(async () => {
    await database.close();
  });

  async function seed(startedAgo: string, timingMode = "per_question") {
    await database.exec(`
      insert into public.assignments (
        id, timing_mode, question_time_limit_seconds
      ) values ('${ids.assignment}', '${timingMode}', 10);

      insert into public.quiz_attempts (
        id, student_id, assignment_id, deadline_at,
        current_question_started_at
      ) values (
        '${ids.attempt}',
        '${ids.student}',
        '${ids.assignment}',
        clock_timestamp() + interval '1 hour',
        clock_timestamp() - interval '${startedAgo}'
      );

      insert into public.quiz_questions (
        id, attempt_id, correct_choice_index
      ) values ('${ids.question}', '${ids.attempt}', 0);
    `);
    await database.exec("set role service_role;");
  }

  async function answer(forceTimeout: boolean) {
    return database.query<{
      received_choice: number;
      timed_out: boolean;
    }>(`
      select
        (result ->> 'receivedChoice')::integer as received_choice,
        (result ->> 'timedOut')::boolean as timed_out
      from (
        select public.answer_quiz_question_v2(
          '${ids.student}'::uuid,
          '${ids.attempt}'::uuid,
          '${ids.question}'::uuid,
          'initial',
          0::smallint,
          ${forceTimeout}
        ) as result
      ) call;
    `);
  }

  it("accepts a manual answer just past the deadline but times out beyond the 250ms grace", async () => {
    await seed("10 seconds 100 milliseconds");
    const withinGrace = await answer(false);
    expect(withinGrace.rows).toEqual([
      { received_choice: 0, timed_out: false },
    ]);

    await database.exec(`
      reset role;
      truncate table public.quiz_questions, public.quiz_attempts,
        public.assignments;
    `);
    await seed("10 seconds 350 milliseconds");
    const pastGrace = await answer(false);
    expect(pastGrace.rows).toEqual([
      { received_choice: 1, timed_out: true },
    ]);
  });

  it("forces timeout at the nominal deadline and rejects an early timeout", async () => {
    await seed("10 seconds 100 milliseconds");
    const forced = await answer(true);
    expect(forced.rows).toEqual([
      { received_choice: 1, timed_out: true },
    ]);

    await database.exec(`
      reset role;
      truncate table public.quiz_questions, public.quiz_attempts,
        public.assignments;
    `);
    await seed("9 seconds");
    await expect(answer(true)).rejects.toThrow("question_time_remaining");
  });

  it("starts the next question after 3000ms and preserves its full limit", async () => {
    await seed("1 second");
    const before = Date.now();
    await answer(false);
    const after = Date.now();
    const response = await database.query<{
      deadline_ms: number;
      started_ms: number;
    }>(`
      select
        extract(
          epoch from current_question_started_at + interval '10 seconds'
        ) * 1000 as deadline_ms,
        extract(epoch from attempt.current_question_started_at) * 1000
          as started_ms
      from public.quiz_attempts as attempt
      where attempt.id = '${ids.attempt}';
    `);
    const row = response.rows[0]!;
    expect(row.started_ms - before).toBeGreaterThanOrEqual(2_950);
    expect(row.started_ms - after).toBeLessThanOrEqual(3_050);
    expect(row.deadline_ms - row.started_ms).toBe(10_000);
  });

  it("adds the locked 3000ms transition back to a total attempt deadline", async () => {
    await seed("1 second", "total");
    const before = await database.query<{ deadline_ms: number }>(`
      select extract(epoch from deadline_at) * 1000 as deadline_ms
      from public.quiz_attempts
      where id = '${ids.attempt}';
    `);
    const wallClockBefore = Date.now();
    await answer(false);
    const wallClockAfter = Date.now();
    const response = await database.query<{
      deadline_ms: number;
      started_ms: number;
    }>(`
      select
        extract(epoch from deadline_at) * 1000 as deadline_ms,
        extract(epoch from current_question_started_at) * 1000 as started_ms
      from public.quiz_attempts
      where id = '${ids.attempt}';
    `);
    const row = response.rows[0]!;
    expect(row.deadline_ms - before.rows[0]!.deadline_ms).toBe(3_000);
    expect(row.started_ms - wallClockBefore).toBeGreaterThanOrEqual(2_950);
    expect(row.started_ms - wallClockAfter).toBeLessThanOrEqual(3_050);
  });

  it("keeps the timing RPC service-role only", async () => {
    const privileges = await database.query<{
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(`
      select
        has_function_privilege(
          'anon',
          'public.answer_quiz_question_v2(uuid,uuid,uuid,text,smallint,boolean)',
          'EXECUTE'
        ) as anon,
        has_function_privilege(
          'authenticated',
          'public.answer_quiz_question_v2(uuid,uuid,uuid,text,smallint,boolean)',
          'EXECUTE'
        ) as authenticated,
        has_function_privilege(
          'service_role',
          'public.answer_quiz_question_v2(uuid,uuid,uuid,text,smallint,boolean)',
          'EXECUTE'
        ) as service;
    `);
    expect(privileges.rows).toEqual([
      { anon: false, authenticated: false, service: true },
    ]);
  });
});
