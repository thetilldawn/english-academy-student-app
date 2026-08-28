import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260828070246_optimize_admin_wrong_summaries.sql",
  ),
  "utf8",
);

const ids = {
  student: "10000000-0000-4000-8000-000000000001",
  otherStudent: "10000000-0000-4000-8000-000000000002",
  dataset: "20000000-0000-4000-8000-000000000001",
  canonicalOne: "30000000-0000-4000-8000-000000000001",
  canonicalTwo: "30000000-0000-4000-8000-000000000002",
  activeDraft: "40000000-0000-4000-8000-000000000001",
  expiredDraft: "40000000-0000-4000-8000-000000000002",
  cancelledDraft: "40000000-0000-4000-8000-000000000003",
  mismatchedDraft: "40000000-0000-4000-8000-000000000004",
} as const;

async function expectPostgresError(
  operation: Promise<unknown>,
  code: string,
) {
  try {
    await operation;
    throw new Error("expected PostgreSQL operation to fail");
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe.sequential("admin wrong-summary optimized reads", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema private;
      grant usage on schema private to authenticated, service_role;

      create table public.students (
        id uuid primary key,
        status text not null,
        current_vocab_dataset_id uuid
      );
      create table public.student_vocab_state (
        student_id uuid not null,
        vocab_entry_id bigint not null,
        unresolved_wrong_count integer not null,
        resolved_at timestamptz,
        canonical_dictionary_id_snapshot text,
        primary key (student_id, vocab_entry_id)
      );
      create table public.vocab_entries (
        id bigint primary key,
        dataset_id uuid not null,
        headword_normalized text not null
      );
      create table public.vocab_entry_quiz_eligibility (
        vocab_entry_id bigint not null,
        dataset_id uuid not null,
        status text not null,
        canonical_lexeme_id uuid
      );
      create table public.student_vocab_wrong_events (
        student_id uuid not null,
        dataset_id uuid not null,
        vocab_entry_id bigint not null,
        quiz_attempt_id uuid not null,
        canonical_dictionary_id_snapshot text,
        canonical_lexeme_id_snapshot uuid,
        wrong_stage text not null
      );
      create table public.student_vocab_review_assignment_drafts (
        id uuid primary key,
        student_id uuid not null,
        dataset_id uuid not null,
        status text not null,
        expires_at timestamptz not null
      );
      create table public.student_vocab_review_queue (
        id uuid primary key,
        student_id uuid not null,
        dataset_id uuid not null,
        vocab_entry_id bigint not null,
        canonical_dictionary_id_snapshot text,
        canonical_lexeme_id_snapshot uuid,
        source_question_id uuid not null,
        reason_level integer not null,
        queued_at timestamptz not null,
        status text not null,
        reserved_review_draft_id uuid
      );

      alter table public.students enable row level security;
      alter table public.student_vocab_state enable row level security;
      alter table public.vocab_entries enable row level security;
      alter table public.vocab_entry_quiz_eligibility
        enable row level security;
      alter table public.student_vocab_wrong_events
        enable row level security;
      alter table public.student_vocab_review_assignment_drafts
        enable row level security;
      alter table public.student_vocab_review_queue
        enable row level security;

      create policy authenticated_students on public.students
        for select to authenticated using (true);
      create policy authenticated_vocab_state on public.student_vocab_state
        for select to authenticated using (true);
      create policy authenticated_vocab_entries on public.vocab_entries
        for select to authenticated using (true);
      create policy authenticated_eligibility
        on public.vocab_entry_quiz_eligibility
        for select to authenticated using (true);
      create policy authenticated_wrong_events
        on public.student_vocab_wrong_events
        for select to authenticated using (true);
      create policy authenticated_review_drafts
        on public.student_vocab_review_assignment_drafts
        for select to authenticated using (true);
      create policy authenticated_review_queue
        on public.student_vocab_review_queue
        for select to authenticated using (true);

      grant select on public.students, public.student_vocab_state,
        public.vocab_entries, public.vocab_entry_quiz_eligibility,
        public.student_vocab_wrong_events,
        public.student_vocab_review_assignment_drafts,
        public.student_vocab_review_queue
        to authenticated, service_role;

      create function private.vocab_identity_matches_v1(
        p_left_dataset_id uuid,
        p_left_vocab_entry_id bigint,
        p_left_dictionary_id text,
        p_left_canonical_lexeme_id uuid,
        p_left_headword text,
        p_right_dataset_id uuid,
        p_right_vocab_entry_id bigint,
        p_right_dictionary_id text,
        p_right_canonical_lexeme_id uuid,
        p_right_headword text
      )
      returns boolean
      language sql
      immutable
      security invoker
      set search_path = ''
      as $$
        select case
          when p_left_dataset_id is distinct from p_right_dataset_id
            then false
          when p_left_dictionary_id is not null
            and p_right_dictionary_id is not null
            then p_left_dictionary_id = p_right_dictionary_id
          when p_left_canonical_lexeme_id is not null
            and p_right_canonical_lexeme_id is not null
            then p_left_canonical_lexeme_id = p_right_canonical_lexeme_id
          when p_left_vocab_entry_id = p_right_vocab_entry_id then true
          when p_left_dictionary_id is null
            and p_right_dictionary_id is null
            and p_left_canonical_lexeme_id is null
            and p_right_canonical_lexeme_id is null
            and nullif(
              lower(trim(replace(p_left_headword, '*', ''))),
              ''
            ) is not null
            then lower(trim(replace(p_left_headword, '*', ''))) =
              lower(trim(replace(p_right_headword, '*', '')))
          else false
        end;
      $$;
      revoke all on function private.vocab_identity_matches_v1(
        uuid, bigint, text, uuid, text,
        uuid, bigint, text, uuid, text
      ) from public, anon;
      grant execute on function private.vocab_identity_matches_v1(
        uuid, bigint, text, uuid, text,
        uuid, bigint, text, uuid, text
      ) to authenticated, service_role;
    `);

    await database.exec(migration);
    await database.exec(`
      insert into public.students values
        ('${ids.student}', 'active', '${ids.dataset}'),
        ('${ids.otherStudent}', 'active', '${ids.dataset}');

      insert into public.vocab_entries values
        (1, '${ids.dataset}', 'alpha'),
        (2, '${ids.dataset}', 'alpha variant'),
        (3, '${ids.dataset}', 'beta'),
        (4, '${ids.dataset}', 'same*'),
        (5, '${ids.dataset}', 'same');
      insert into public.vocab_entry_quiz_eligibility values
        (1, '${ids.dataset}', 'eligible', '${ids.canonicalOne}'),
        (2, '${ids.dataset}', 'eligible', '${ids.canonicalOne}'),
        (3, '${ids.dataset}', 'eligible', '${ids.canonicalTwo}'),
        (4, '${ids.dataset}', 'eligible', null),
        (5, '${ids.dataset}', 'eligible', null);
      insert into public.student_vocab_state values
        ('${ids.student}', 1, 1, null, 'dictionary-alpha'),
        ('${ids.student}', 2, 1, null, null),
        ('${ids.student}', 3, 1, null, null),
        ('${ids.student}', 4, 1, null, null),
        ('${ids.student}', 5, 1, null, null);
      insert into public.student_vocab_wrong_events values
        ('${ids.student}', '${ids.dataset}', 1,
          '50000000-0000-4000-8000-000000000001',
          'dictionary-alpha', '${ids.canonicalOne}', 'initial'),
        ('${ids.student}', '${ids.dataset}', 2,
          '50000000-0000-4000-8000-000000000002',
          null, '${ids.canonicalOne}', 'initial'),
        ('${ids.student}', '${ids.dataset}', 3,
          '50000000-0000-4000-8000-000000000003',
          null, '${ids.canonicalTwo}', 'initial'),
        ('${ids.student}', '${ids.dataset}', 4,
          '50000000-0000-4000-8000-000000000004',
          null, null, 'initial'),
        ('${ids.student}', '${ids.dataset}', 5,
          '50000000-0000-4000-8000-000000000005',
          null, null, 'initial');

      insert into public.student_vocab_review_assignment_drafts values
        ('${ids.activeDraft}', '${ids.student}', '${ids.dataset}',
          'pending', transaction_timestamp() + interval '1 hour'),
        ('${ids.expiredDraft}', '${ids.student}', '${ids.dataset}',
          'pending', transaction_timestamp() - interval '1 hour'),
        ('${ids.cancelledDraft}', '${ids.student}', '${ids.dataset}',
          'cancelled', transaction_timestamp() + interval '1 hour'),
        ('${ids.mismatchedDraft}', '${ids.otherStudent}', '${ids.dataset}',
          'pending', transaction_timestamp() + interval '1 hour');
      insert into public.student_vocab_review_queue values
        ('60000000-0000-4000-8000-000000000001', '${ids.student}',
          '${ids.dataset}', 1, null, '${ids.canonicalOne}',
          '70000000-0000-4000-8000-000000000001', 1,
          transaction_timestamp(), 'pending', '${ids.activeDraft}'),
        ('60000000-0000-4000-8000-000000000002', '${ids.student}',
          '${ids.dataset}', 2, null, '${ids.canonicalOne}',
          '70000000-0000-4000-8000-000000000002', 2,
          transaction_timestamp(), 'pending', '${ids.expiredDraft}'),
        ('60000000-0000-4000-8000-000000000003', '${ids.student}',
          '${ids.dataset}', 3, null, '${ids.canonicalTwo}',
          '70000000-0000-4000-8000-000000000003', 1,
          transaction_timestamp(), 'pending', '${ids.cancelledDraft}'),
        ('60000000-0000-4000-8000-000000000004', '${ids.student}',
          '${ids.dataset}', 4, null, null,
          '70000000-0000-4000-8000-000000000004', 2,
          transaction_timestamp(), 'pending', '${ids.mismatchedDraft}');
    `);
  }, 20_000);

  afterAll(async () => {
    await database.close();
  });

  it("shows only pending, unexpired, matching reservations", async () => {
    await database.exec("set role authenticated;");
    const rows = await database.query<{
      id: string;
      active_review_draft_id: string | null;
    }>(`
      select id, active_review_draft_id
      from public.student_vocab_review_queue_read_v1
      order by id;
    `);
    const summary = await database.query<{
      pending_level_1_count: number;
      pending_level_2_count: number;
      reserved_level_1_count: number;
      reserved_level_2_count: number;
    }>(`
      select pending_level_1_count, pending_level_2_count,
        reserved_level_1_count, reserved_level_2_count
      from public.list_student_vocab_review_queue_summaries()
      where student_id = '${ids.student}'
        and dataset_id = '${ids.dataset}';
    `);
    await database.exec("reset role;");

    expect(rows.rows.map((row) => row.active_review_draft_id)).toEqual([
      ids.activeDraft,
      null,
      null,
      null,
    ]);
    expect(summary.rows).toEqual([
      {
        pending_level_1_count: 2,
        pending_level_2_count: 2,
        reserved_level_1_count: 1,
        reserved_level_2_count: 0,
      },
    ]);
  });

  it("preserves dictionary, canonical, and headword identity counts", async () => {
    await database.exec("set role authenticated;");
    const rows = await database.query<{
      student_id: string;
      wrong_word_count: number;
      repeated_wrong_word_count: number;
    }>(`
      select student_id, wrong_word_count, repeated_wrong_word_count
      from public.list_student_current_vocab_wrong_summaries(null, 500)
      order by student_id;
    `);
    await database.exec("reset role;");

    expect(rows.rows).toEqual([
      {
        student_id: ids.student,
        wrong_word_count: 3,
        repeated_wrong_word_count: 2,
      },
      {
        student_id: ids.otherStudent,
        wrong_word_count: 0,
        repeated_wrong_word_count: 0,
      },
    ]);
  });

  it("keeps the view and both RPCs unavailable to anonymous callers", async () => {
    await database.exec("set role anon;");
    await expectPostgresError(
      database.query(
        "select * from public.student_vocab_review_queue_read_v1;",
      ),
      "42501",
    );
    await expectPostgresError(
      database.query(
        "select * from public.list_student_vocab_review_queue_summaries();",
      ),
      "42501",
    );
    await expectPostgresError(
      database.query(
        "select * from public.list_student_current_vocab_wrong_summaries();",
      ),
      "42501",
    );
    await database.exec("reset role;");
  });
});
