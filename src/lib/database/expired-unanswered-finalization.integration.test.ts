import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260822010400_finalize_expired_unanswered_as_wrong.sql",
  ),
  "utf8",
);

const ids = {
  attempt: "00000000-0000-4000-8000-000000000101",
  newerAttempt: "00000000-0000-4000-8000-000000000102",
  student: "00000000-0000-4000-8000-000000000001",
  q1: "00000000-0000-4000-8000-000000000201",
  q2: "00000000-0000-4000-8000-000000000202",
  q3: "00000000-0000-4000-8000-000000000203",
} as const;

describe.sequential("expired unanswered finalization", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create schema private;

      create table public.quiz_attempts (
        id uuid primary key,
        student_id uuid not null,
        status text not null,
        phase text not null,
        started_at timestamptz not null,
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

      create table public.quiz_questions (
        id uuid primary key,
        attempt_id uuid not null references public.quiz_attempts(id),
        vocab_entry_id bigint not null,
        initial_choice_index smallint,
        initial_is_correct boolean,
        initial_answered_at timestamptz,
        retry_choice_index smallint,
        retry_is_correct boolean,
        retry_answered_at timestamptz,
        initial_timed_out boolean not null default false,
        retry_timed_out boolean not null default false
      );

      create table public.student_vocab_state (
        student_id uuid not null,
        vocab_entry_id bigint not null,
        unresolved_wrong_count integer not null,
        last_wrong_at timestamptz,
        resolved_at timestamptz,
        last_attempt_id uuid not null,
        last_evaluated_at timestamptz not null,
        primary key (student_id, vocab_entry_id)
      );

      create table public.student_vocab_wrong_events (
        quiz_question_id uuid not null,
        wrong_stage text not null,
        primary key (quiz_question_id, wrong_stage)
      );

      create function private.capture_wrong_events()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        insert into public.student_vocab_wrong_events (
          quiz_question_id,
          wrong_stage
        )
        select question.id, stage.wrong_stage
        from public.quiz_questions as question
        cross join lateral (
          values
            ('initial'::text, question.initial_is_correct),
            ('retry'::text, question.retry_is_correct)
        ) as stage(wrong_stage, is_correct)
        where question.attempt_id = new.id
          and stage.is_correct is false
        on conflict (quiz_question_id, wrong_stage) do nothing;
        return new;
      end;
      $$;

      create trigger capture_wrong_events
      after update of status on public.quiz_attempts
      for each row
      when (old.status = 'in_progress' and new.status in ('completed', 'expired'))
      execute function private.capture_wrong_events();
    `);
    await database.exec(migration);
  }, 20_000);

  afterEach(async () => {
    await database.exec(`
      truncate table public.student_vocab_wrong_events,
        public.student_vocab_state,
        public.quiz_questions,
        public.quiz_attempts;
    `);
  });

  afterAll(async () => {
    await database.close();
  });

  async function seedAttempt(phase: "initial" | "retry") {
    await database.exec(`
      insert into public.quiz_attempts (
        id,
        student_id,
        status,
        phase,
        started_at,
        initial_completed_at,
        retry_started_at,
        deadline_at
      ) values (
        '${ids.attempt}',
        '${ids.student}',
        'in_progress',
        '${phase}',
        clock_timestamp() - interval '10 minutes',
        ${phase === "retry" ? "clock_timestamp() - interval '8 minutes'" : "null"},
        ${phase === "retry" ? "clock_timestamp() - interval '5 minutes'" : "null"},
        clock_timestamp() - interval '1 minute'
      );
    `);
  }

  async function finalize() {
    return database.query<{ result: Record<string, unknown> }>(`
      select private.finalize_expired_quiz_attempt(
        '${ids.student}'::uuid,
        '${ids.attempt}'::uuid
      ) as result;
    `);
  }

  it("stores an unanswered initial question as a timed-out wrong answer exactly once", async () => {
    await seedAttempt("initial");
    await database.exec(`
      insert into public.quiz_questions (
        id, attempt_id, vocab_entry_id,
        initial_choice_index, initial_is_correct
      ) values
        ('${ids.q1}', '${ids.attempt}', 1, 0, true),
        ('${ids.q2}', '${ids.attempt}', 2, 1, false),
        ('${ids.q3}', '${ids.attempt}', 3, null, null);
    `);

    await finalize();
    const attempt = await database.query<{
      initial_correct_count: number;
      unresolved_wrong_count: number;
    }>(`
      select initial_correct_count, unresolved_wrong_count
      from public.quiz_attempts where id = '${ids.attempt}';
    `);
    const unanswered = await database.query<{
      initial_choice_index: number | null;
      initial_is_correct: boolean;
      initial_timed_out: boolean;
    }>(`
      select initial_choice_index, initial_is_correct, initial_timed_out
      from public.quiz_questions where id = '${ids.q3}';
    `);
    const events = await database.query<{ count: number }>(`
      select count(*)::integer as count
      from public.student_vocab_wrong_events;
    `);
    const wrongStates = await database.query<{ vocab_entry_id: number }>(`
      select vocab_entry_id
      from public.student_vocab_state
      where unresolved_wrong_count = 1
      order by vocab_entry_id;
    `);

    expect(attempt.rows).toEqual([
      { initial_correct_count: 1, unresolved_wrong_count: 2 },
    ]);
    expect(unanswered.rows).toEqual([
      {
        initial_choice_index: null,
        initial_is_correct: false,
        initial_timed_out: true,
      },
    ]);
    expect(events.rows).toEqual([{ count: 2 }]);
    expect(wrongStates.rows).toEqual([{ vocab_entry_id: 2 }, { vocab_entry_id: 3 }]);

    await finalize();
    expect(
      (await database.query(`select * from public.student_vocab_wrong_events`))
        .rows,
    ).toHaveLength(2);
    expect(
      (
        await database.query(`
          select * from public.student_vocab_state
          where unresolved_wrong_count = 1
        `)
      ).rows,
    ).toHaveLength(2);
  });

  it("marks an unanswered retry target wrong without changing its missing choice", async () => {
    await seedAttempt("retry");
    await database.exec(`
      insert into public.quiz_questions (
        id, attempt_id, vocab_entry_id,
        initial_choice_index, initial_is_correct,
        retry_choice_index, retry_is_correct
      ) values
        ('${ids.q1}', '${ids.attempt}', 1, 1, false, 0, true),
        ('${ids.q2}', '${ids.attempt}', 2, 1, false, null, null),
        ('${ids.q3}', '${ids.attempt}', 3, 0, true, null, null);
    `);

    await finalize();
    const attempt = await database.query<{
      retry_correct_count: number;
      unresolved_wrong_count: number;
    }>(`
      select retry_correct_count, unresolved_wrong_count
      from public.quiz_attempts where id = '${ids.attempt}';
    `);
    const unanswered = await database.query<{
      retry_choice_index: number | null;
      retry_is_correct: boolean;
      retry_timed_out: boolean;
    }>(`
      select retry_choice_index, retry_is_correct, retry_timed_out
      from public.quiz_questions where id = '${ids.q2}';
    `);
    const retryEvents = await database.query<{ count: number }>(`
      select count(*)::integer as count
      from public.student_vocab_wrong_events
      where wrong_stage = 'retry';
    `);

    expect(attempt.rows).toEqual([
      { retry_correct_count: 1, unresolved_wrong_count: 1 },
    ]);
    expect(unanswered.rows).toEqual([
      {
        retry_choice_index: null,
        retry_is_correct: false,
        retry_timed_out: true,
      },
    ]);
    expect(retryEvents.rows).toEqual([{ count: 1 }]);
  });

  it("does not let a late finalizer overwrite a newer learning state", async () => {
    await database.exec(`
      insert into public.quiz_attempts (
        id, student_id, status, phase, started_at, deadline_at
      ) values (
        '${ids.attempt}',
        '${ids.student}',
        'in_progress',
        'initial',
        '2026-08-20T09:00:00.000Z',
        '2026-08-20T10:00:00.000Z'
      );

      insert into public.quiz_questions (
        id, attempt_id, vocab_entry_id,
        initial_choice_index, initial_is_correct
      ) values (
        '${ids.q1}', '${ids.attempt}', 9, null, null
      );

      insert into public.student_vocab_state (
        student_id, vocab_entry_id, unresolved_wrong_count,
        last_wrong_at, resolved_at, last_attempt_id, last_evaluated_at
      ) values (
        '${ids.student}', 9, 0,
        null, '2026-08-20T11:00:00.000Z', '${ids.newerAttempt}',
        '2026-08-20T11:00:00.000Z'
      );
    `);

    await finalize();

    const state = await database.query<{
      last_attempt_id: string;
      unresolved_wrong_count: number;
    }>(`
      select last_attempt_id::text, unresolved_wrong_count
      from public.student_vocab_state
      where student_id = '${ids.student}' and vocab_entry_id = 9;
    `);
    expect(state.rows).toEqual([
      {
        last_attempt_id: ids.newerAttempt,
        unresolved_wrong_count: 0,
      },
    ]);
  });
});
