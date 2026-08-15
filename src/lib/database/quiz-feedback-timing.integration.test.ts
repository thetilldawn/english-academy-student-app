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
const audioEndedFeedbackMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260815121000_resume_quiz_after_audio_feedback.sql",
  ),
  "utf8",
);
const variableFeedbackMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260815123000_resume_quiz_after_variable_feedback.sql",
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
        status text not null default 'in_progress',
        phase text not null default 'initial',
        deadline_at timestamptz not null,
        current_question_started_at timestamptz not null
      );

      create table public.quiz_questions (
        id uuid primary key,
        attempt_id uuid not null references public.quiz_attempts(id),
        order_index integer not null,
        correct_choice_index smallint not null,
        initial_choice_index smallint,
        initial_is_correct boolean,
        initial_answered_at timestamptz,
        retry_choice_index smallint,
        retry_answered_at timestamptz,
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
      language plpgsql
      security invoker
      set search_path = ''
      as $$
      begin
        update public.quiz_questions
        set initial_choice_index = p_choice_index,
            initial_is_correct = p_choice_index = 0,
            initial_answered_at = clock_timestamp()
        where id = p_question_id;
        return jsonb_build_object(
          'completed', false,
          'correct', p_choice_index = 0,
          'correctChoiceIndex', 0,
          'expired', false,
          'nextQuestionId', '${ids.nextQuestion}',
          'nextPhase', 'initial',
          'receivedChoice', p_choice_index
        );
      end;
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
    await database.exec(audioEndedFeedbackMigration);
    await database.exec(variableFeedbackMigration);
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
        id, attempt_id, order_index, correct_choice_index
      ) values
        ('${ids.question}', '${ids.attempt}', 1, 0),
        ('${ids.nextQuestion}', '${ids.attempt}', 2, 0);
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
        select public.answer_quiz_question_v3(
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

  async function resume(delayMilliseconds = 150) {
    return database.query<{
      deadline_ms: number;
      started_ms: number;
    }>(`
      select
        extract(epoch from (result ->> 'questionDeadlineAt')::timestamptz) * 1000
          as deadline_ms,
        extract(epoch from (result ->> 'questionStartsAt')::timestamptz) * 1000
          as started_ms
      from (
        select public.resume_quiz_after_feedback_v2(
          '${ids.student}'::uuid,
          '${ids.attempt}'::uuid,
          '${ids.nextQuestion}'::uuid,
          'initial',
          ${delayMilliseconds}
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

  it("starts the next question after 7000ms and preserves its full limit", async () => {
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
    expect(row.started_ms - before).toBeGreaterThanOrEqual(6_950);
    expect(row.started_ms - after).toBeLessThanOrEqual(7_050);
    expect(row.deadline_ms - row.started_ms).toBe(10_000);
  });

  it("adds the locked 7000ms transition back to a total attempt deadline", async () => {
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
    expect(row.deadline_ms - before.rows[0]!.deadline_ms).toBe(7_000);
    expect(row.started_ms - wallClockBefore).toBeGreaterThanOrEqual(6_950);
    expect(row.started_ms - wallClockAfter).toBeLessThanOrEqual(7_050);
  });

  it("rejects a duplicate answer before it can add another transition", async () => {
    await seed("1 second", "total");
    await answer(false);
    await database.exec(`
      update public.quiz_attempts
      set current_question_started_at = clock_timestamp() - interval '1 millisecond'
      where id = '${ids.attempt}';
    `);
    await expect(answer(false)).rejects.toThrow("question_already_answered");
  });

  it("rejects the next answer before its feedback transition has started", async () => {
    await seed("1 second");
    await answer(false);
    await expect(
      database.query(`
        select public.answer_quiz_question_v3(
          '${ids.student}'::uuid,
          '${ids.attempt}'::uuid,
          '${ids.nextQuestion}'::uuid,
          'initial',
          0::smallint,
          false
        );
      `),
    ).rejects.toThrow("question_not_started");
  });

  it("moves the next per-question clock to 150ms after audio completion", async () => {
    await seed("1 second");
    await answer(false);
    const before = Date.now();
    const resumed = await resume();
    const after = Date.now();
    const row = resumed.rows[0]!;
    expect(row.started_ms - before).toBeGreaterThanOrEqual(100);
    expect(row.started_ms - after).toBeLessThanOrEqual(200);
    expect(row.deadline_ms - row.started_ms).toBe(10_000);
  });

  it("uses the requested 750ms silent-feedback window", async () => {
    await seed("1 second");
    await answer(false);
    const before = Date.now();
    const resumed = await resume(750);
    const after = Date.now();
    const row = resumed.rows[0]!;
    expect(row.started_ms - before).toBeGreaterThanOrEqual(700);
    expect(row.started_ms - after).toBeLessThanOrEqual(800);
    expect(row.deadline_ms - row.started_ms).toBe(10_000);
  });

  it("rejects a feedback window outside the 750ms transition cap", async () => {
    await seed("1 second");
    await answer(false);
    await expect(resume(751)).rejects.toThrow("invalid_feedback_delay");
  });

  it("never extends the server clock after the original 7000ms slot", async () => {
    await seed("1 second");
    await answer(false);
    await database.exec(`
      update public.quiz_attempts
      set current_question_started_at = clock_timestamp() - interval '100 milliseconds'
      where id = '${ids.attempt}';
    `);
    const before = Date.now();
    const resumed = await resume();
    const row = resumed.rows[0]!;
    expect(Number(row.started_ms)).toBeLessThan(before);
    expect(row.deadline_ms - row.started_ms).toBe(10_000);
  });

  it("refunds only the elapsed audio feedback in total timing and is idempotent", async () => {
    await seed("1 second", "total");
    const original = await database.query<{ deadline_ms: number }>(`
      select extract(epoch from deadline_at) * 1000 as deadline_ms
      from public.quiz_attempts where id = '${ids.attempt}';
    `);
    await answer(false);
    const first = await resume();
    const second = await resume();
    const row = first.rows[0]!;
    const refunded = row.deadline_ms - original.rows[0]!.deadline_ms;
    expect(refunded).toBeGreaterThanOrEqual(100);
    expect(refunded).toBeLessThanOrEqual(250);
    expect(second.rows[0]).toEqual(row);
  });

  it("only shortens a total-timer transition when delays are retried", async () => {
    await seed("1 second", "total");
    await answer(false);
    const silent = await resume(750);
    const audioEnded = await resume(150);
    const staleRetry = await resume(750);

    expect(Number(audioEnded.rows[0]!.started_ms)).toBeLessThan(
      Number(silent.rows[0]!.started_ms),
    );
    expect(Number(audioEnded.rows[0]!.deadline_ms)).toBeLessThan(
      Number(silent.rows[0]!.deadline_ms),
    );
    expect(staleRetry.rows[0]).toEqual(audioEnded.rows[0]);
  });

  it("rejects a stale or mismatched next-question signal", async () => {
    await seed("1 second");
    await answer(false);
    await expect(
      database.query(`
        select public.resume_quiz_after_feedback_v2(
          '${ids.student}'::uuid,
          '${ids.attempt}'::uuid,
          '${ids.question}'::uuid,
          'initial',
          150
        );
      `),
    ).rejects.toThrow("next_question_mismatch");
  });

  it("keeps the timing RPC service-role only", async () => {
    const privileges = await database.query<{
      anon: boolean;
      authenticated: boolean;
      service: boolean;
      guarded_anon: boolean;
      guarded_authenticated: boolean;
      guarded_service: boolean;
      resume_anon: boolean;
      resume_authenticated: boolean;
      resume_service: boolean;
      variable_resume_anon: boolean;
      variable_resume_authenticated: boolean;
      variable_resume_service: boolean;
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
        ) as service,
        has_function_privilege(
          'anon',
          'public.answer_quiz_question_v3(uuid,uuid,uuid,text,smallint,boolean)',
          'EXECUTE'
        ) as guarded_anon,
        has_function_privilege(
          'authenticated',
          'public.answer_quiz_question_v3(uuid,uuid,uuid,text,smallint,boolean)',
          'EXECUTE'
        ) as guarded_authenticated,
        has_function_privilege(
          'service_role',
          'public.answer_quiz_question_v3(uuid,uuid,uuid,text,smallint,boolean)',
          'EXECUTE'
        ) as guarded_service,
        has_function_privilege(
          'anon',
          'public.resume_quiz_after_feedback_v1(uuid,uuid,uuid,text)',
          'EXECUTE'
        ) as resume_anon,
        has_function_privilege(
          'authenticated',
          'public.resume_quiz_after_feedback_v1(uuid,uuid,uuid,text)',
          'EXECUTE'
        ) as resume_authenticated,
        has_function_privilege(
          'service_role',
          'public.resume_quiz_after_feedback_v1(uuid,uuid,uuid,text)',
          'EXECUTE'
        ) as resume_service,
        has_function_privilege(
          'anon',
          'public.resume_quiz_after_feedback_v2(uuid,uuid,uuid,text,integer)',
          'EXECUTE'
        ) as variable_resume_anon,
        has_function_privilege(
          'authenticated',
          'public.resume_quiz_after_feedback_v2(uuid,uuid,uuid,text,integer)',
          'EXECUTE'
        ) as variable_resume_authenticated,
        has_function_privilege(
          'service_role',
          'public.resume_quiz_after_feedback_v2(uuid,uuid,uuid,text,integer)',
          'EXECUTE'
        ) as variable_resume_service;
    `);
    expect(privileges.rows).toEqual([
      {
        anon: false,
        authenticated: false,
        guarded_anon: false,
        guarded_authenticated: false,
        guarded_service: true,
        resume_anon: false,
        resume_authenticated: false,
        resume_service: true,
        service: true,
        variable_resume_anon: false,
        variable_resume_authenticated: false,
        variable_resume_service: true,
      },
    ]);
  });
});
