import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationsDirectory = path.resolve("supabase/migrations");
const migrationPaths = fs
  .readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => path.join(migrationsDirectory, name));
const lifecycleRollbackSql = fs.readFileSync(
  path.resolve(
    "supabase/rollback/20260730235400_stabilize_wrong_assignment_lifecycle.sql",
  ),
  "utf8",
);
const adminDeletionRollbackSql = fs.readFileSync(
  path.resolve(
    "supabase/rollback/20260731010000_admin_deletion_controls.sql",
  ),
  "utf8",
);

const ids = {
  admin: "00000000-0000-4000-8000-000000000001",
  student: "00000000-0000-4000-8000-000000000002",
  dataset: "00000000-0000-4000-8000-000000000003",
  units: [
    "00000000-0000-4000-8000-000000000101",
    "00000000-0000-4000-8000-000000000102",
    "00000000-0000-4000-8000-000000000103",
    "00000000-0000-4000-8000-000000000104",
    "00000000-0000-4000-8000-000000000105",
  ],
  lexemes: [
    "00000000-0000-4000-8000-000000000201",
    "00000000-0000-4000-8000-000000000202",
    "00000000-0000-4000-8000-000000000203",
    "00000000-0000-4000-8000-000000000204",
  ],
  selectedQueue: "00000000-0000-4000-8000-000000000301",
  overlappingQueue: "00000000-0000-4000-8000-000000000302",
  exactQueue: "00000000-0000-4000-8000-000000000303",
  rollbackQueue: "00000000-0000-4000-8000-000000000304",
  exactDraft: "00000000-0000-4000-8000-000000000401",
  rollbackDraft: "00000000-0000-4000-8000-000000000402",
} as const;

type FinalSchemaDatabaseOptions = {
  beforeMigration?: (
    database: PGlite,
    migrationName: string,
  ) => Promise<void>;
};

async function createFinalSchemaDatabase(
  options: FinalSchemaDatabaseOptions = {},
) {
  const database = new PGlite({
    extensions: {
      pgcrypto,
    },
  });

  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create schema cron;
    create schema extensions;
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
      set
        schedule = excluded.schedule,
        command = excluded.command
      returning jobid into scheduled_job_id;
      return scheduled_job_id;
    end;
    $$;
    create table auth.users (
      id uuid primary key
    );
    create function auth.uid()
    returns uuid
    language sql
    stable
    set search_path = ''
    as $$
      select nullif(
        current_setting('request.jwt.claim.sub', true),
        ''
      )::uuid;
    $$;
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
  `);

  for (const migrationPath of migrationPaths) {
    const migrationName = path.basename(migrationPath);
    await options.beforeMigration?.(database, migrationName);
    const migration = fs
      .readFileSync(migrationPath, "utf8")
      .replace(
        "create extension if not exists pg_cron;",
        "",
      );
    await database.exec(migration);
  }

  return database;
}

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

async function seedReviewAssignmentScenario(database: PGlite) {
  await database.exec(`
    select set_config(
      'request.jwt.claim.sub',
      '${ids.admin}',
      false
    );
    select set_config(
      'request.jwt.claim.role',
      'authenticated',
      false
    );
    select set_config(
      'request.jwt.claims',
      '{"role":"authenticated"}',
      false
    );

    insert into auth.users (id)
    values ('${ids.admin}');

    insert into public.admin_profiles (
      user_id,
      display_name,
      is_active
    )
    values ('${ids.admin}', 'Test admin', true);

    insert into public.students (
      id,
      display_name,
      status,
      created_by
    )
    values (
      '${ids.student}',
      'Test student',
      'active',
      '${ids.admin}'
    );

    insert into public.vocab_datasets (
      id,
      dataset_key,
      title,
      source_label,
      source_sha256,
      row_count,
      status,
      is_active,
      imported_by
    )
    values (
      '${ids.dataset}',
      'final-schema-test',
      'Final schema test',
      'integration fixture',
      repeat('A', 64),
      5,
      'ready',
      true,
      '${ids.admin}'
    );

    insert into public.vocab_units (
      id,
      dataset_id,
      unit_label,
      normalized_label,
      unit_kind,
      unit_number,
      sort_index,
      entry_count
    )
    select
      unit_id,
      '${ids.dataset}',
      'DAY ' || sort_index,
      'day-' || sort_index,
      'day',
      sort_index,
      sort_index,
      case when sort_index in (1, 5) then 1 else 0 end
    from unnest(array[
      '${ids.units[0]}'::uuid,
      '${ids.units[1]}'::uuid,
      '${ids.units[2]}'::uuid,
      '${ids.units[3]}'::uuid,
      '${ids.units[4]}'::uuid
    ]) with ordinality as selected(unit_id, sort_index);

    insert into word_index.lexeme (
      lexeme_id,
      identity_key,
      entity_key,
      origin_bucket,
      headword,
      normalized_headword,
      lexeme_type,
      type_status,
      intended_use,
      lifecycle_status,
      source_note_path,
      source_note_sha256,
      content_hash,
      created_at_utc,
      updated_at_utc
    )
    select
      lexeme_id,
      'identity-' || position,
      'entity-' || position,
      'fixture',
      'word-' || position,
      'word-' || position,
      'word',
      'confirmed',
      'quiz',
      'active',
      'fixture/' || position || '.md',
      upper(lpad(to_hex(position), 64, '0')),
      upper(lpad(to_hex(position + 10), 64, '0')),
      clock_timestamp(),
      clock_timestamp()
    from unnest(array[
      '${ids.lexemes[0]}'::uuid,
      '${ids.lexemes[1]}'::uuid,
      '${ids.lexemes[2]}'::uuid,
      '${ids.lexemes[3]}'::uuid
    ]) with ordinality as selected(lexeme_id, position);

    insert into public.vocab_entries (
      id,
      dataset_id,
      source_row,
      headword,
      headword_normalized,
      meanings,
      primary_meaning,
      source_ref,
      row_sha256,
      unit_id,
      position_in_unit,
      entry_type
    )
    overriding system value
    values
      (
        1, '${ids.dataset}', 1, 'alpha', 'alpha',
        array['알파'], '알파', 'DAY 1 · word',
        repeat('1', 64), '${ids.units[0]}', 1, 'word'
      ),
      (
        2, '${ids.dataset}', 2, 'beta', 'beta',
        array['베타'], '베타', 'DAY 5 · word',
        repeat('2', 64), '${ids.units[4]}', 1, 'word'
      ),
      (
        3, '${ids.dataset}', 3, 'gamma', 'gamma',
        array['감마'], '감마', 'DAY 5 · word',
        repeat('3', 64), '${ids.units[4]}', 2, 'word'
      ),
      (
        4, '${ids.dataset}', 4, 'delta', 'delta',
        array['델타'], '델타', 'DAY 5 · word',
        repeat('4', 64), '${ids.units[4]}', 3, 'word'
      ),
      (
        5, '${ids.dataset}', 5, 'beta variant', 'beta variant',
        array['베타 변형'], '베타 변형', 'DAY 5 · word',
        repeat('5', 64), '${ids.units[4]}', 4, 'word'
      );

    insert into public.vocab_entry_quiz_eligibility (
      vocab_entry_id,
      dataset_id,
      quiz_mode,
      status,
      input_content_hash,
      canonical_lexeme_id,
      canonical_content_hash,
      rule_version,
      evaluated_at_utc
    )
    select
      entry.id,
      entry.dataset_id,
      mode.quiz_mode,
      'eligible',
      entry.row_sha256,
      case entry.id
        when 1 then '${ids.lexemes[0]}'::uuid
        when 2 then '${ids.lexemes[1]}'::uuid
        when 3 then '${ids.lexemes[2]}'::uuid
        when 4 then '${ids.lexemes[3]}'::uuid
        else '${ids.lexemes[1]}'::uuid
      end,
      case entry.id
        when 1 then repeat('1', 64)
        when 2 then repeat('2', 64)
        when 3 then repeat('3', 64)
        when 4 then repeat('4', 64)
        else repeat('2', 64)
      end,
      'fixture-v1',
      clock_timestamp()
    from public.vocab_entries as entry
    cross join (
      values
        ('book_meaning_en_to_ko'),
        ('book_meaning_ko_to_en')
    ) as mode(quiz_mode)
    where entry.dataset_id = '${ids.dataset}';

    set session_replication_role = replica;
    insert into public.student_vocab_review_queue (
      id,
      student_id,
      dataset_id,
      vocab_entry_id,
      canonical_lexeme_id_snapshot,
      source_attempt_id,
      source_question_id,
      reason_level,
      status,
      queued_by,
      queued_at
    )
    values
      (
        '${ids.selectedQueue}',
        '${ids.student}',
        '${ids.dataset}',
        1,
        '${ids.lexemes[0]}',
        '00000000-0000-4000-8000-000000000501',
        '00000000-0000-4000-8000-000000000601',
        1,
        'pending',
        '${ids.admin}',
        '2026-01-01T00:00:00Z'
      ),
      (
        '${ids.overlappingQueue}',
        '${ids.student}',
        '${ids.dataset}',
        5,
        '${ids.lexemes[1]}',
        '00000000-0000-4000-8000-000000000502',
        '00000000-0000-4000-8000-000000000602',
        1,
        'pending',
        '${ids.admin}',
        '2026-01-02T00:00:00Z'
      );
    set session_replication_role = origin;
  `);

  // The v3 bank builder has its own migration contracts. This stub keeps its
  // persistence shape so this suite can isolate the final review wrapper,
  // queue transaction, purpose and primary-unit invariants.
  await database.exec(`
    create or replace function private.create_assignment_with_question_bank_v3(
      p_title text,
      p_dataset_id uuid,
      p_unit_ids uuid[],
      p_question_count integer,
      p_english_to_korean_ratio smallint,
      p_time_limit_seconds integer,
      p_passing_score smallint,
      p_question_order_mode public.question_order_mode,
      p_available_until timestamptz,
      p_student_ids uuid[],
      p_questions jsonb
    )
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      created_assignment_id uuid :=
        extensions.gen_random_uuid();
    begin
      insert into public.assignments (
        id,
        title,
        dataset_id,
        range_start,
        range_end,
        question_count,
        english_to_korean_ratio,
        time_limit_seconds,
        passing_score,
        status,
        available_from,
        available_until,
        created_by,
        range_basis,
        question_order_mode,
        question_bank_version
      )
      values (
        created_assignment_id,
        p_title,
        p_dataset_id,
        1,
        p_question_count,
        p_question_count,
        p_english_to_korean_ratio,
        p_time_limit_seconds,
        p_passing_score,
        'active',
        clock_timestamp(),
        p_available_until,
        auth.uid(),
        'units',
        p_question_order_mode,
        1
      );

      insert into public.assignment_units (
        assignment_id,
        dataset_id,
        unit_id,
        position
      )
      select
        created_assignment_id,
        p_dataset_id,
        selected.unit_id,
        selected.position::integer
      from unnest(p_unit_ids) with ordinality
        as selected(unit_id, position);

      insert into public.assignment_students (
        assignment_id,
        student_id,
        assigned_by
      )
      select
        created_assignment_id,
        selected.student_id,
        auth.uid()
      from unnest(p_student_ids) as selected(student_id);

      insert into public.assignment_questions (
        assignment_id,
        vocab_entry_id,
        base_order_index,
        direction,
        prompt,
        choices,
        correct_choice_index,
        dataset_id,
        canonical_lexeme_id_snapshot
      )
      select
        created_assignment_id,
        question.vocab_entry_id,
        question.base_order_index,
        question.direction::public.question_direction,
        'prompt-' || question.vocab_entry_id,
        jsonb_build_array('A', 'B', 'C', 'D'),
        0,
        p_dataset_id,
        (
          select min(eligibility.canonical_lexeme_id::text)::uuid
          from public.vocab_entry_quiz_eligibility as eligibility
          where eligibility.vocab_entry_id = question.vocab_entry_id
            and eligibility.dataset_id = p_dataset_id
            and eligibility.status = 'eligible'
        )
      from jsonb_to_recordset(p_questions) as question(
        vocab_entry_id bigint,
        base_order_index integer,
        direction text,
        choice_vocab_entry_ids bigint[]
      );

      if p_title = 'Post-consume rollback' then
        perform pg_sleep(0.1);
      end if;

      return created_assignment_id;
    end;
    $$;
  `);
}

const mixedQuestions = JSON.stringify([
  {
    vocab_entry_id: 2,
    base_order_index: 1,
    direction: "english_to_korean",
    choice_vocab_entry_ids: [1, 2, 3, 4],
  },
  {
    vocab_entry_id: 3,
    base_order_index: 2,
    direction: "english_to_korean",
    choice_vocab_entry_ids: [1, 2, 3, 4],
  },
  {
    vocab_entry_id: 4,
    base_order_index: 3,
    direction: "english_to_korean",
    choice_vocab_entry_ids: [1, 2, 3, 4],
  },
  {
    vocab_entry_id: 1,
    base_order_index: 4,
    direction: "english_to_korean",
    choice_vocab_entry_ids: [1, 2, 3, 4],
  },
]);

async function createRegularPointAttempt(
  database: PGlite,
  title: string,
  options: {
    availableUntil?: Date | null;
    studentId?: string;
    timeLimitSeconds?: number;
    timingMode?: "none" | "total";
  } = {},
) {
  const studentId = options.studentId ?? ids.student;
  const timingMode = options.timingMode ?? "total";
  const timeLimitSeconds = options.timeLimitSeconds ?? 300;
  const availableUntilSql = options.availableUntil
    ? `'${options.availableUntil.toISOString()}'::timestamptz`
    : "null";
  await database.exec("set role authenticated;");
  let assignmentId: string;
  try {
    const created = await database.query<{ assignment_id: string }>(`
      select public.create_assignment_with_delivery_v7(
        '${title}',
        '${ids.dataset}',
        array['${ids.units[0]}'::uuid, '${ids.units[4]}'::uuid],
        4,
        100::smallint,
        ${timeLimitSeconds},
        100::smallint,
        true,
        100::smallint,
        'fixed',
        ${availableUntilSql},
        array['${studentId}'::uuid],
        '${timingMode}',
        null,
        $questions$${mixedQuestions}$questions$::jsonb
      ) as assignment_id;
    `);
    assignmentId = created.rows[0]!.assignment_id;
  } finally {
    await database.exec("reset role;");
  }

  const attempt = await database.query<{ attempt_id: string }>(`
      select public.create_quiz_attempt_from_bank(
      '${studentId}',
      '${assignmentId}'
    ) as attempt_id;
  `);
  const attemptId = attempt.rows[0]!.attempt_id;
  const questions = await database.query<{
    correct_choice_index: number;
    id: string;
  }>(`
    select id, correct_choice_index
    from public.quiz_questions
    where attempt_id = '${attemptId}'
    order by order_index;
  `);

  return { assignmentId, attemptId, questions: questions.rows };
}

describe.sequential("final review-assignment database schema", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = await createFinalSchemaDatabase();
  }, 30_000);

  afterAll(async () => {
    await database?.close();
  });

  it("applies every migration and exposes only the intended mixed RPC", async () => {
    const signatures = await database.query<{
      private_core: string | null;
      public_mixed: string | null;
      exact_v4: string | null;
      public_review_summary: string | null;
    }>(`
      select
        to_regprocedure(
          'private.persist_review_assignment_v5(uuid,uuid,uuid[],uuid,text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)'
        )::text as private_core,
        to_regprocedure(
          'public.create_mixed_review_assignment_v5(uuid,uuid,smallint[],integer,uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)'
        )::text as public_mixed,
        to_regprocedure(
          'public.create_exact_review_assignment_v4(uuid,text,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)'
        )::text as exact_v4,
        to_regprocedure(
          'public.list_student_vocab_review_queue_summaries(uuid,uuid,integer)'
        )::text as public_review_summary;
    `);

    expect(signatures.rows[0]?.private_core).not.toBeNull();
    expect(signatures.rows[0]?.public_mixed).not.toBeNull();
    expect(signatures.rows[0]?.exact_v4).not.toBeNull();
    expect(signatures.rows[0]?.public_review_summary).not.toBeNull();
    const coreDefinition = await database.query<{
      definition: string;
    }>(`
      select pg_get_functiondef(
        'private.persist_review_assignment_v5(uuid,uuid,uuid[],uuid,text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)'::regprocedure
      ) as definition;
    `);
    expect(coreDefinition.rows[0]?.definition).toContain(
      "cardinality(p_review_queue_ids) not between 1 and 500",
    );
    expect(coreDefinition.rows[0]?.definition).toContain(
      "review_question_count > total_question_count",
    );
    const queueWriterDefinition = await database.query<{
      definition: string;
    }>(`
      select pg_get_functiondef(
        'private.create_vocab_assignment_queues_v1(uuid,text,jsonb)'::regprocedure
      ) as definition;
    `);
    expect(queueWriterDefinition.rows[0]?.definition).toContain(
      "jsonb_array_length(p_series) not between 1 and 210",
    );

    const privileges = await database.query<{
      authenticated_core: boolean;
      authenticated_private_mixed: boolean;
      authenticated_public_mixed: boolean;
      authenticated_public_exact: boolean;
      authenticated_public_mixed_v6: boolean;
      authenticated_public_mixed_v8: boolean;
      authenticated_public_mixed_v9: boolean;
      authenticated_public_regular_v4: boolean;
      authenticated_public_regular_v6: boolean;
      authenticated_public_bulk_v1: boolean;
      authenticated_public_bulk_v3: boolean;
      authenticated_public_bulk_v4: boolean;
      authenticated_public_queue_v3: boolean;
      authenticated_private_queue_v2: boolean;
      authenticated_public_identity_v1: boolean;
      authenticated_public_review_summary: boolean;
      authenticated_replace_v2: boolean;
      authenticated_replace_v3: boolean;
      authenticated_replace_v4: boolean;
      authenticated_replace_v5: boolean;
      authenticated_replace_v6: boolean;
      authenticated_series_context_v1: boolean;
      authenticated_replace_v1: boolean;
      service_replace_v1: boolean;
      authenticated_replacement_ledger_select: boolean;
      anon_public_mixed: boolean;
      anon_public_exact: boolean;
      anon_public_review_summary: boolean;
      anon_replace_v2: boolean;
      anon_public_mixed_v9: boolean;
      anon_public_bulk_v4: boolean;
      anon_public_queue_v3: boolean;
      anon_replace_v4: boolean;
      anon_series_context_v1: boolean;
    }>(`
      select
        has_function_privilege(
          'authenticated',
          'private.persist_review_assignment_v5(uuid,uuid,uuid[],uuid,text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)',
          'execute'
        ) as authenticated_core,
        has_function_privilege(
          'authenticated',
          'private.create_mixed_review_assignment_v5(uuid,uuid,smallint[],integer,uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)',
          'execute'
        ) as authenticated_private_mixed,
        has_function_privilege(
          'authenticated',
          'public.create_mixed_review_assignment_v5(uuid,uuid,smallint[],integer,uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)',
          'execute'
        ) as authenticated_public_mixed,
        has_function_privilege(
          'authenticated',
          'public.create_exact_review_assignment_v4(uuid,text,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)',
          'execute'
        ) as authenticated_public_exact,
        has_function_privilege(
          'authenticated',
          'public.create_mixed_review_assignment_v6(uuid,uuid,smallint[],uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)',
          'execute'
        ) as authenticated_public_mixed_v6,
        has_function_privilege(
          'authenticated',
          'public.create_mixed_review_assignment_v8(uuid,uuid,smallint[],text,uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)',
          'execute'
        ) as authenticated_public_mixed_v8,
        has_function_privilege(
          'authenticated',
          'public.create_mixed_review_assignment_v9(uuid,uuid,smallint[],text,uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)',
          'execute'
        ) as authenticated_public_mixed_v9,
        has_function_privilege(
          'authenticated',
          'public.create_assignment_with_delivery_v4(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],text,integer,jsonb)',
          'execute'
        ) as authenticated_public_regular_v4,
        has_function_privilege(
          'authenticated',
          'public.create_assignment_with_delivery_v6(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],text,integer,jsonb)',
          'execute'
        ) as authenticated_public_regular_v6,
        has_function_privilege(
          'authenticated',
          'public.create_bulk_vocab_assignments_v1(jsonb)',
          'execute'
        ) as authenticated_public_bulk_v1,
        has_function_privilege(
          'authenticated',
          'public.create_bulk_vocab_assignments_v3(jsonb)',
          'execute'
        ) as authenticated_public_bulk_v3,
        has_function_privilege(
          'authenticated',
          'public.create_bulk_vocab_assignments_v4(jsonb)',
          'execute'
        ) as authenticated_public_bulk_v4,
        has_function_privilege(
          'authenticated',
          'public.create_vocab_assignment_queues_v3(uuid,text,jsonb)',
          'execute'
        ) as authenticated_public_queue_v3,
        has_function_privilege(
          'authenticated',
          'private.create_vocab_assignment_queues_v2(uuid,text,jsonb)',
          'execute'
        ) as authenticated_private_queue_v2,
        has_function_privilege(
          'authenticated',
          'public.list_assignment_question_dictionary_identities_v1(uuid[],uuid)',
          'execute'
        ) as authenticated_public_identity_v1,
        has_function_privilege(
          'authenticated',
          'public.list_student_vocab_review_queue_summaries(uuid,uuid,integer)',
          'execute'
        ) as authenticated_public_review_summary,
        has_function_privilege(
          'authenticated',
          'public.replace_student_assignment_v2(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)',
          'execute'
        ) as authenticated_replace_v2,
        has_function_privilege(
          'authenticated',
          'public.replace_student_assignment_v3(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)',
          'execute'
        ) as authenticated_replace_v3,
        has_function_privilege(
          'authenticated',
          'public.replace_student_assignment_v4(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)',
          'execute'
        ) as authenticated_replace_v4,
        has_function_privilege(
          'authenticated',
          'public.replace_student_assignment_v5(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)',
          'execute'
        ) as authenticated_replace_v5,
        has_function_privilege(
          'authenticated',
          'public.replace_student_assignment_v6(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamp with time zone,timestamp with time zone,text,integer,smallint[],text,uuid[],jsonb)',
          'execute'
        ) as authenticated_replace_v6,
        has_function_privilege(
          'authenticated',
          'public.get_assignment_edit_series_context_v1(uuid,uuid)',
          'execute'
        ) as authenticated_series_context_v1,
        has_function_privilege(
          'authenticated',
          'public.replace_student_assignment_v1(uuid,uuid,uuid,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)',
          'execute'
        ) as authenticated_replace_v1,
        has_function_privilege(
          'service_role',
          'public.replace_student_assignment_v1(uuid,uuid,uuid,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)',
          'execute'
        ) as service_replace_v1,
        has_table_privilege(
          'authenticated',
          'private.assignment_replacement_requests',
          'select'
        ) as authenticated_replacement_ledger_select,
        has_function_privilege(
          'anon',
          'public.create_mixed_review_assignment_v5(uuid,uuid,smallint[],integer,uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)',
          'execute'
        ) as anon_public_mixed,
        has_function_privilege(
          'anon',
          'public.create_exact_review_assignment_v4(uuid,text,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)',
          'execute'
        ) as anon_public_exact,
        has_function_privilege(
          'anon',
          'public.list_student_vocab_review_queue_summaries(uuid,uuid,integer)',
          'execute'
        ) as anon_public_review_summary,
        has_function_privilege(
          'anon',
          'public.replace_student_assignment_v2(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)',
          'execute'
        ) as anon_replace_v2,
        has_function_privilege(
          'anon',
          'public.create_mixed_review_assignment_v9(uuid,uuid,smallint[],text,uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)',
          'execute'
        ) as anon_public_mixed_v9,
        has_function_privilege(
          'anon',
          'public.create_bulk_vocab_assignments_v4(jsonb)',
          'execute'
        ) as anon_public_bulk_v4,
        has_function_privilege(
          'anon',
          'public.create_vocab_assignment_queues_v3(uuid,text,jsonb)',
          'execute'
        ) as anon_public_queue_v3,
        has_function_privilege(
          'anon',
          'public.replace_student_assignment_v4(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)',
          'execute'
        ) as anon_replace_v4,
        has_function_privilege(
          'anon',
          'public.get_assignment_edit_series_context_v1(uuid,uuid)',
          'execute'
        ) as anon_series_context_v1;
    `);

    expect(privileges.rows[0]).toEqual({
      authenticated_core: false,
      authenticated_private_mixed: false,
      authenticated_public_mixed: false,
      authenticated_public_exact: false,
      authenticated_public_mixed_v6: false,
      authenticated_public_mixed_v8: true,
      authenticated_public_mixed_v9: true,
      authenticated_public_regular_v4: false,
      authenticated_public_regular_v6: true,
      authenticated_public_bulk_v1: false,
      authenticated_public_bulk_v3: false,
      authenticated_public_bulk_v4: false,
      authenticated_public_queue_v3: true,
      authenticated_private_queue_v2: false,
      authenticated_public_identity_v1: true,
      authenticated_public_review_summary: true,
      authenticated_replace_v2: false,
      authenticated_replace_v3: false,
      // The rolling-deploy bridge now forwards to v5/v7; the old private writer stays closed.
      authenticated_replace_v4: true,
      authenticated_replace_v5: true,
      authenticated_replace_v6: true,
      authenticated_series_context_v1: true,
      authenticated_replace_v1: false,
      service_replace_v1: false,
      authenticated_replacement_ledger_select: false,
      anon_public_mixed: false,
      anon_public_exact: false,
      anon_public_review_summary: false,
      anon_replace_v2: false,
      anon_public_mixed_v9: false,
      anon_public_bulk_v4: false,
      anon_public_queue_v3: false,
      anon_replace_v4: false,
      anon_series_context_v1: false,
    });
  });

  it("preserves edit metadata, rebinds a queued session, and advances after completion", async () => {
    const database = await createFinalSchemaDatabase();
    const queueRequestId = "00000000-0000-4000-8000-000000000901";
    const seriesId = "00000000-0000-4000-8000-000000000902";
    const currentItemId = "00000000-0000-4000-8000-000000000903";
    const nextItemId = "00000000-0000-4000-8000-000000000904";
    const idempotencyKey = "00000000-0000-4000-8000-000000000905";
    const missingScheduleKey = "00000000-0000-4000-8000-000000000906";
    const availableFrom = "2026-08-01T01:00:00Z";
    const availableUntil = "2099-09-01T02:00:00Z";
    try {
      await seedReviewAssignmentScenario(database);
      await database.exec("set role authenticated;");
      const source = await database.query<{ assignment_id: string }>(`
        select public.create_assignment_with_delivery_v7(
          'Queued edit source',
          '${ids.dataset}',
          array['${ids.units[0]}'::uuid, '${ids.units[4]}'::uuid],
          4,
          100::smallint,
          300,
          80::smallint,
          true,
          80::smallint,
          'fixed',
          null,
          array['${ids.student}'::uuid],
          'total',
          null,
          $questions$${mixedQuestions}$questions$::jsonb
        ) as assignment_id;
      `);
      await database.exec("reset role;");
      const sourceAssignmentId = source.rows[0]!.assignment_id;

      await database.exec(`
        update public.assignments
        set
          available_from = '2026-07-01T01:00:00Z'::timestamptz,
          available_until = '2099-08-01T02:00:00Z'::timestamptz
        where id = '${sourceAssignmentId}';

        insert into private.vocab_assignment_queue_requests (
          idempotency_key,
          request_sha256,
          payload_sha256,
          actor_admin_id
        ) values (
          '${queueRequestId}', repeat('1', 64), repeat('2', 64), '${ids.admin}'
        );

        insert into private.vocab_assignment_series (
          id,
          request_id,
          student_id,
          dataset_id,
          actor_admin_id,
          dataset_label,
          range_label,
          recurrence_slots,
          status
        ) values (
          '${seriesId}',
          '${queueRequestId}',
          '${ids.student}',
          '${ids.dataset}',
          '${ids.admin}',
          'Edit queue dataset',
          'DAY 1, DAY 5',
          '[{"isodow":1,"local_time":"10:00","duration_seconds":3600}]'::jsonb,
          'active'
        );

        insert into private.vocab_assignment_series_items (
          id,
          series_id,
          sequence_number,
          status,
          question_count,
          unit_ids,
          unit_labels,
          planned_available_from,
          planned_available_until,
          effective_available_from,
          effective_available_until,
          payload,
          assignment_id,
          materialized_at
        ) values
          (
            '${currentItemId}',
            '${seriesId}',
            1,
            'assigned',
            4,
            array['${ids.units[0]}'::uuid, '${ids.units[4]}'::uuid],
            array['DAY 1', 'DAY 5'],
            '2026-07-01T01:00:00Z'::timestamptz,
            '2099-08-01T02:00:00Z'::timestamptz,
            '2026-07-01T01:00:00Z'::timestamptz,
            '2099-08-01T02:00:00Z'::timestamptz,
            '{"passing_score":80,"retry_enabled":true,"retry_passing_score":80}'::jsonb,
            '${sourceAssignmentId}',
            clock_timestamp()
          ),
          (
            '${nextItemId}',
            '${seriesId}',
            2,
            'queued',
            4,
            array['${ids.units[0]}'::uuid, '${ids.units[4]}'::uuid],
            array['DAY 1', 'DAY 5'],
            '2099-09-08T01:00:00Z'::timestamptz,
            '2099-09-08T02:00:00Z'::timestamptz,
            '2099-09-08T01:00:00Z'::timestamptz,
            '2099-09-08T02:00:00Z'::timestamptz,
            '{"passing_score":80,"retry_enabled":true,"retry_passing_score":80}'::jsonb,
            null,
            null
          );
      `);

      await database.exec("set role authenticated;");
      await expectPostgresError(
        database.query(`
          select public.replace_student_assignment_v6(
            '${sourceAssignmentId}', '${ids.student}',
            '${missingScheduleKey}', repeat('f', 64),
            'regular', 'none', 'Missing series schedule',
            '${ids.dataset}',
            array['${ids.units[0]}'::uuid, '${ids.units[4]}'::uuid],
            4, 100::smallint, 600, 90::smallint, false, null,
            'fixed', null, null, 'total', null,
            array[]::smallint[], 'dataset', array[]::uuid[],
            $questions$${mixedQuestions}$questions$::jsonb
          );
        `),
        "22023",
        "vocab_assignment_series_schedule_required",
      );
      await database.exec("reset role;");
      const beforeReplacement = await database.query<{
        cancelled: boolean;
        item_status: string;
      }>(`
        select
          link.cancelled_at is not null as cancelled,
          item.status as item_status
        from public.assignment_students as link
        join private.vocab_assignment_series_items as item
          on item.assignment_id = link.assignment_id
        where link.assignment_id = '${sourceAssignmentId}'
          and link.student_id = '${ids.student}';
      `);
      expect(beforeReplacement.rows[0]).toEqual({
        cancelled: false,
        item_status: "assigned",
      });

      await database.exec("set role authenticated;");
      const first = await database.query<{
        result: {
          idempotent: boolean;
          replacementAssignmentId: string;
        };
      }>(`
        select public.replace_student_assignment_v6(
          '${sourceAssignmentId}',
          '${ids.student}',
          '${idempotencyKey}',
          repeat('a', 64),
          'regular',
          'none',
          'Queued edit replacement',
          '${ids.dataset}',
          array['${ids.units[0]}'::uuid, '${ids.units[4]}'::uuid],
          4,
          100::smallint,
          600,
          90::smallint,
          false,
          null,
          'fixed',
          '${availableFrom}'::timestamptz,
          '${availableUntil}'::timestamptz,
          'total',
          null,
          array[]::smallint[],
          'dataset',
          array[]::uuid[],
          $questions$${mixedQuestions}$questions$::jsonb
        ) as result;
      `);
      const replay = await database.query<{
        result: {
          idempotent: boolean;
          replacementAssignmentId: string;
        };
      }>(`
        select public.replace_student_assignment_v6(
          '${sourceAssignmentId}',
          '${ids.student}',
          '${idempotencyKey}',
          repeat('a', 64),
          'regular',
          'none',
          'Queued edit replacement',
          '${ids.dataset}',
          array['${ids.units[0]}'::uuid, '${ids.units[4]}'::uuid],
          4,
          100::smallint,
          600,
          90::smallint,
          false,
          null,
          'fixed',
          '${availableFrom}'::timestamptz,
          '${availableUntil}'::timestamptz,
          'total',
          null,
          array[]::smallint[],
          'dataset',
          array[]::uuid[],
          $questions$${mixedQuestions}$questions$::jsonb
        ) as result;
      `);
      const recoveredByNewLookup = await database.query<{
        result: { idempotent: boolean; replacementAssignmentId: string };
      }>(`
        select public.get_student_assignment_replacement_result_v2(
          '${sourceAssignmentId}', '${ids.student}', '${idempotencyKey}',
          repeat('a', 64), '${availableFrom}'::timestamptz, 'dataset',
          false, null
        ) as result;
      `);
      const recoveredByRollingLookup = await database.query<{
        result: { idempotent: boolean; replacementAssignmentId: string };
      }>(`
        select public.get_student_assignment_replacement_result_v1(
          '${sourceAssignmentId}', '${ids.student}', '${idempotencyKey}',
          repeat('a', 64)
        ) as result;
      `);
      expect(recoveredByNewLookup.rows[0]!.result.idempotent).toBe(true);
      expect(recoveredByRollingLookup.rows[0]!.result.idempotent).toBe(true);
      await expectPostgresError(
        database.query(`
          select public.get_student_assignment_replacement_result_v2(
            '${sourceAssignmentId}', '${ids.student}', '${idempotencyKey}',
            repeat('a', 64), '${availableFrom}'::timestamptz, 'dataset',
            true, 90::smallint
          );
        `),
        "23505",
        "idempotency_key_reused",
      );
      await expectPostgresError(
        database.query(`
          select public.replace_student_assignment_v6(
            '${sourceAssignmentId}', '${ids.student}', '${idempotencyKey}',
            repeat('a', 64), 'regular', 'none', 'Queued edit replacement',
            '${ids.dataset}',
            array['${ids.units[0]}'::uuid, '${ids.units[4]}'::uuid],
            4, 100::smallint, 600, 90::smallint, false, null, 'fixed',
            '2026-08-02T01:00:00Z'::timestamptz,
            '${availableUntil}'::timestamptz,
            'total', null, array[]::smallint[], 'dataset',
            array[]::uuid[],
            $questions$${mixedQuestions}$questions$::jsonb
          );
        `),
        "23505",
        "idempotency_key_reused",
      );
      await database.exec("reset role;");

      const replacementAssignmentId =
        first.rows[0]!.result.replacementAssignmentId;
      expect(first.rows[0]!.result.idempotent).toBe(false);
      expect(replay.rows[0]!.result).toMatchObject({
        idempotent: true,
        replacementAssignmentId,
      });

      const reboundState = await database.query<{
        attention_assignment_id: string;
        attention_at: string;
        attention_events: number;
        item_attention: string | null;
        item_status: string;
        replaced_assignment_id: string;
        replaced_at: string;
        replaced_events: number;
        series_attention: string | null;
        series_status: string;
      }>(`
        select
          item.status as item_status,
          item.attention_reason as item_attention,
          series.status as series_status,
          series.attention_reason as series_attention,
          (
            select count(*)::integer
            from private.vocab_assignment_series_events
            where series_id = '${seriesId}'
              and event_kind = 'session.attention'
          ) as attention_events,
          (
            select assignment_id::text
            from private.vocab_assignment_series_events
            where series_id = '${seriesId}'
              and event_kind = 'session.attention'
          ) as attention_assignment_id,
          (
            select occurred_at::text
            from private.vocab_assignment_series_events
            where series_id = '${seriesId}'
              and event_kind = 'session.attention'
          ) as attention_at,
          (
            select count(*)::integer
            from private.vocab_assignment_series_events
            where series_id = '${seriesId}'
              and event_kind = 'session.replaced'
          ) as replaced_events,
          (
            select assignment_id::text
            from private.vocab_assignment_series_events
            where series_id = '${seriesId}'
              and event_kind = 'session.replaced'
          ) as replaced_assignment_id,
          (
            select occurred_at::text
            from private.vocab_assignment_series_events
            where series_id = '${seriesId}'
              and event_kind = 'session.replaced'
          ) as replaced_at
        from private.vocab_assignment_series_items as item
        join private.vocab_assignment_series as series
          on series.id = item.series_id
        where item.id = '${currentItemId}';
      `);
      expect(reboundState.rows[0]).toMatchObject({
        attention_assignment_id: sourceAssignmentId,
        attention_events: 1,
        item_attention: null,
        item_status: "assigned",
        replaced_assignment_id: replacementAssignmentId,
        replaced_events: 1,
        series_attention: null,
        series_status: "active",
      });
      expect(
        new Date(reboundState.rows[0]!.attention_at).getTime(),
      ).toBeLessThanOrEqual(
        new Date(reboundState.rows[0]!.replaced_at).getTime(),
      );

      const attempt = await database.query<{ attempt_id: string }>(`
        select public.create_quiz_attempt_from_bank(
          '${ids.student}', '${replacementAssignmentId}'
        ) as attempt_id;
      `);
      await database.exec(`
        update public.quiz_attempts
        set
          status = 'completed',
          phase = 'completed',
          completed_at = clock_timestamp(),
          initial_correct_count = question_count_snapshot,
          retry_correct_count = 0,
          unresolved_wrong_count = 0,
          initial_score = 100,
          final_score = 100,
          passed = true,
          elapsed_seconds = 0
        where id = '${attempt.rows[0]!.attempt_id}';
      `);

      const state = await database.query<{
        available_from: string;
        available_until: string;
        review_scope: string;
        retry_enabled: boolean;
        retry_passing_score: number | null;
        source_cancelled: boolean;
        current_assignment_id: string;
        current_status: string;
        next_status: string;
        series_status: string;
        replaced_events: number;
        completed_events: number;
        ready_events: number;
        metadata_audits: number;
        effective_available_from: string;
        effective_available_until: string;
        payload_retry_enabled: boolean;
      }>(`
        select
          assignment.available_from::text as available_from,
          assignment.available_until::text as available_until,
          assignment.review_scope,
          assignment.retry_enabled,
          assignment.retry_passing_score,
          (
            select cancelled_at is not null
            from public.assignment_students
            where assignment_id = '${sourceAssignmentId}'
              and student_id = '${ids.student}'
          ) as source_cancelled,
          current_item.assignment_id::text as current_assignment_id,
          current_item.status as current_status,
          current_item.effective_available_from::text as effective_available_from,
          current_item.effective_available_until::text as effective_available_until,
          (current_item.payload ->> 'retry_enabled')::boolean as payload_retry_enabled,
          next_item.status as next_status,
          series.status as series_status,
          (
            select count(*)::integer
            from private.vocab_assignment_series_events
            where series_id = '${seriesId}' and event_kind = 'session.replaced'
          ) as replaced_events,
          (
            select count(*)::integer
            from private.vocab_assignment_series_events
            where series_id = '${seriesId}' and event_kind = 'session.completed'
          ) as completed_events,
          (
            select count(*)::integer
            from private.vocab_assignment_series_events
            where series_id = '${seriesId}' and event_kind = 'session.ready'
          ) as ready_events,
          (
            select count(*)::integer
            from public.audit_events
            where event_type = 'assignment.student.replacement_metadata_v1'
              and details ->> 'sourceAssignmentId' = '${sourceAssignmentId}'
          ) as metadata_audits
        from public.assignments as assignment
        join private.vocab_assignment_series_items as current_item
          on current_item.id = '${currentItemId}'
        join private.vocab_assignment_series_items as next_item
          on next_item.id = '${nextItemId}'
        join private.vocab_assignment_series as series
          on series.id = '${seriesId}'
        where assignment.id = '${replacementAssignmentId}';
      `);
      expect(state.rows[0]).toMatchObject({
        review_scope: "dataset",
        retry_enabled: false,
        retry_passing_score: null,
        source_cancelled: true,
        current_assignment_id: replacementAssignmentId,
        current_status: "completed",
        next_status: "ready",
        series_status: "active",
        replaced_events: 1,
        completed_events: 1,
        ready_events: 1,
        metadata_audits: 1,
        payload_retry_enabled: false,
      });
      expect(new Date(state.rows[0]!.available_from).toISOString()).toBe(
        "2026-08-01T01:00:00.000Z",
      );
      expect(new Date(state.rows[0]!.available_until).toISOString()).toBe(
        "2099-09-01T02:00:00.000Z",
      );
      expect(
        new Date(state.rows[0]!.effective_available_from).toISOString(),
      ).toBe("2026-08-01T01:00:00.000Z");
      expect(
        new Date(state.rows[0]!.effective_available_until).toISOString(),
      ).toBe("2099-09-01T02:00:00.000Z");
    } finally {
      await database.close();
    }
  }, 50_000);

  it("validates and persists an explicitly descending DAY range", async () => {
    const rangeDatabase = await createFinalSchemaDatabase();
    try {
      await seedReviewAssignmentScenario(rangeDatabase);
      const created = await rangeDatabase.query<{ assignment_id: string }>(`
        select private.create_assignment_with_question_bank_v3(
          'Descending range fixture',
          '${ids.dataset}',
          array[
            '${ids.units[0]}'::uuid,
            '${ids.units[1]}'::uuid,
            '${ids.units[2]}'::uuid,
            '${ids.units[3]}'::uuid
          ],
          4,
          50::smallint,
          300,
          80::smallint,
          'fixed',
          null,
          array['${ids.student}'::uuid],
          $questions$${mixedQuestions}$questions$::jsonb
        ) as assignment_id;
      `);
      const assignmentId = created.rows[0]!.assignment_id;

      const direction = await rangeDatabase.query<{ direction: number }>(`
        select private.resolve_contiguous_unit_direction_v1(
          '${ids.dataset}',
          array[
            '${ids.units[3]}'::uuid,
            '${ids.units[2]}'::uuid,
            '${ids.units[1]}'::uuid,
            '${ids.units[0]}'::uuid
          ]
        )::integer as direction;
      `);
      expect(direction.rows[0]?.direction).toBe(-1);

      const sparseDirection = await rangeDatabase.query<{ direction: number }>(`
        select private.resolve_contiguous_unit_direction_v1(
          '${ids.dataset}',
          array[
            '${ids.units[0]}'::uuid,
            '${ids.units[2]}'::uuid
          ]
        )::integer as direction;
      `);
      expect(sparseDirection.rows[0]?.direction).toBe(1);

      await rangeDatabase.query(`
        select private.align_assignment_unit_direction_v1(
          '${assignmentId}',
          '${ids.dataset}',
          array[
            '${ids.units[3]}'::uuid,
            '${ids.units[2]}'::uuid,
            '${ids.units[1]}'::uuid,
            '${ids.units[0]}'::uuid
          ]
        );
      `);
      const persisted = await rangeDatabase.query<{ unit_ids: string[] }>(`
        select array_agg(unit_id order by position) as unit_ids
        from public.assignment_units
        where assignment_id = '${assignmentId}'
          and is_primary;
      `);
      expect(persisted.rows[0]?.unit_ids).toEqual([
        ids.units[3],
        ids.units[2],
        ids.units[1],
        ids.units[0],
      ]);

      await expectPostgresError(
        rangeDatabase.query(`
          select private.resolve_contiguous_unit_direction_v1(
            '${ids.dataset}',
            array[
              '${ids.units[3]}'::uuid,
              '${ids.units[1]}'::uuid,
              '${ids.units[2]}'::uuid
            ]
          );
        `),
        "22023",
        "assignment_unit_range_not_monotonic",
      );
    } finally {
      await rangeDatabase.close();
    }
  }, 30_000);

  it("persists sparse bulk ranges and materializes overlapping queued sessions", async () => {
    const sparseDatabase = await createFinalSchemaDatabase();
    try {
      await seedReviewAssignmentScenario(sparseDatabase);
      // This suite replaces the legacy v3 bank builder with a persistence
      // stub after migrations. Mirror the queue's actor-aware wrapper so this
      // test isolates sparse links, overlap policy and completion advancement.
      await sparseDatabase.exec(`
        create or replace function private.create_assignment_with_question_bank_v3_system_v1(
          p_actor_admin_id uuid,
          p_title text,
          p_dataset_id uuid,
          p_unit_ids uuid[],
          p_question_count integer,
          p_english_to_korean_ratio smallint,
          p_time_limit_seconds integer,
          p_passing_score smallint,
          p_question_order_mode public.question_order_mode,
          p_available_until timestamptz,
          p_student_ids uuid[],
          p_questions jsonb
        )
        returns uuid
        language sql
        security definer
        set search_path = ''
        as $$
          select private.create_assignment_with_question_bank_v3(
            p_title,
            p_dataset_id,
            p_unit_ids,
            p_question_count,
            p_english_to_korean_ratio,
            p_time_limit_seconds,
            p_passing_score,
            p_question_order_mode,
            p_available_until,
            p_student_ids,
            p_questions
          );
        $$;
      `);
      const makeBatch = (
        title: string,
        availableFrom: string,
        availableUntil: string,
        sessionNumber = 1,
        sessionCount = 1,
      ) => ({
        kind: "regular",
        student_id: ids.student,
        dataset_id: ids.dataset,
        unit_ids: [ids.units[0], ids.units[4]],
        unit_labels: ["DAY 1", "DAY 5"],
        title,
        question_count: 4,
        english_to_korean_ratio: 100,
        time_limit_seconds: 300,
        passing_score: 80,
        retry_enabled: true,
        retry_passing_score: 80,
        question_order_mode: "fixed",
        available_from: availableFrom,
        available_until: availableUntil,
        timing_mode: "total",
        question_time_limit_seconds: null,
        session_number: sessionNumber,
        session_count: sessionCount,
        questions: JSON.parse(mixedQuestions),
      });
      const createBulk = async (
        requestId: string,
        requestHash: string,
        batch: ReturnType<typeof makeBatch>,
      ) => sparseDatabase.query(`
        select public.create_bulk_vocab_assignments_v10(
          '${requestId}',
          '${requestHash}',
          $batches$${JSON.stringify([batch])}$batches$::jsonb
        );
      `);

      const firstWindow = {
        from: "2030-01-01T00:00:00.000Z",
        until: "2030-01-01T14:00:00.000Z",
      };
      const secondWindow = {
        from: "2030-01-08T00:00:00.000Z",
        until: "2030-01-08T14:00:00.000Z",
      };
      const firstBatch = makeBatch(
        "Sparse first",
        firstWindow.from,
        firstWindow.until,
      );
      await createBulk(
        "00000000-0000-4000-8000-000000000501",
        "a".repeat(64),
        firstBatch,
      );
      await expectPostgresError(
        createBulk(
          "00000000-0000-4000-8000-000000000501",
          "a".repeat(64),
          { ...firstBatch, retry_passing_score: 90 },
        ),
        "23505",
        "idempotency_key_reused",
      );
      const firstBatchAfterRejectedReplay = await sparseDatabase.query<{
        assignment_count: number;
        retry_enabled: boolean;
        retry_passing_score: number;
      }>(`
        select
          count(*)::integer as assignment_count,
          bool_and(assignment.retry_enabled) as retry_enabled,
          min(assignment.retry_passing_score)::integer as retry_passing_score
        from public.assignments as assignment
        where assignment.title = 'Sparse first';
      `);
      expect(firstBatchAfterRejectedReplay.rows[0]).toEqual({
        assignment_count: 1,
        retry_enabled: true,
        retry_passing_score: 80,
      });
      await createBulk(
        "00000000-0000-4000-8000-000000000502",
        "b".repeat(64),
        makeBatch("Sparse overlap", firstWindow.from, firstWindow.until),
      );

      const readExistingOverlapAssignments = () => sparseDatabase.query<{
        id: string;
        title: string;
        status: string;
        available_from: string;
        available_until: string;
        updated_at: string;
        deleted_at: string | null;
        cancelled_at: string | null;
        missed_at: string | null;
      }>(`
        select
          assignment.id,
          assignment.title,
          assignment.status::text as status,
          assignment.available_from::text as available_from,
          assignment.available_until::text as available_until,
          assignment.updated_at::text as updated_at,
          assignment.deleted_at::text as deleted_at,
          recipient.cancelled_at::text as cancelled_at,
          recipient.missed_at::text as missed_at
        from public.assignments as assignment
        join public.assignment_students as recipient
          on recipient.assignment_id = assignment.id
        where recipient.student_id = '${ids.student}'
          and assignment.title in (
            'Sparse first',
            'Sparse overlap',
            'Future overlap'
          )
        order by assignment.title;
      `);
      const firstWindowAssignmentsBeforeQueue =
        await readExistingOverlapAssignments();
      expect(firstWindowAssignmentsBeforeQueue.rows.map((row) => row.title)).toEqual([
        "Sparse first",
        "Sparse overlap",
      ]);

      const seriesPayload = [{
        student_id: ids.student,
        dataset_id: ids.dataset,
        dataset_label: "Final schema test",
        range_label: "DAY 1 외 1개",
        recurrence_slots: [{
          isodow: 2,
          local_time: "09:00:00",
          duration_seconds: 50400,
        }],
        items: [
          makeBatch(
            "Sparse queue 1",
            firstWindow.from,
            firstWindow.until,
            1,
            2,
          ),
          makeBatch(
            "Sparse queue 2",
            secondWindow.from,
            secondWindow.until,
            2,
            2,
          ),
        ],
      }];
      await sparseDatabase.query(`
        select public.create_vocab_assignment_queues_v2(
          '00000000-0000-4000-8000-000000000503',
          '${"c".repeat(64)}',
          $series$${JSON.stringify(seriesPayload)}$series$::jsonb
        );
      `);
      expect((await readExistingOverlapAssignments()).rows).toEqual(
        firstWindowAssignmentsBeforeQueue.rows,
      );

      await createBulk(
        "00000000-0000-4000-8000-000000000504",
        "d".repeat(64),
        makeBatch("Future overlap", secondWindow.from, secondWindow.until),
      );
      const existingAssignmentsBeforeFollowUp =
        await readExistingOverlapAssignments();
      expect(existingAssignmentsBeforeFollowUp.rows.map((row) => row.title)).toEqual([
        "Future overlap",
        "Sparse first",
        "Sparse overlap",
      ]);
      const firstQueueItem = await sparseDatabase.query<{
        assignment_id: string;
      }>(`
        select item.assignment_id
        from private.vocab_assignment_series_items as item
        join private.vocab_assignment_series as series
          on series.id = item.series_id
        where series.request_id = '00000000-0000-4000-8000-000000000503'
          and item.sequence_number = 1;
      `);
      const firstQueueAssignmentId = firstQueueItem.rows[0]?.assignment_id;
      expect(firstQueueAssignmentId).toBeTruthy();
      await sparseDatabase.exec(`
        insert into public.quiz_attempts (
          id,
          student_id,
          assignment_id,
          attempt_number,
          status,
          phase,
          started_at,
          deadline_at,
          question_count_snapshot,
          time_limit_seconds_snapshot,
          passing_score_snapshot,
          passing_basis_snapshot
        ) values (
          '00000000-0000-4000-8000-000000000505',
          '${ids.student}',
          '${firstQueueAssignmentId}',
          1,
          'in_progress',
          'initial',
          clock_timestamp(),
          clock_timestamp() + interval '1 hour',
          4,
          300,
          80,
          'initial'
        );

        update public.quiz_attempts
        set status = 'completed',
            phase = 'completed',
            initial_completed_at = clock_timestamp(),
            completed_at = clock_timestamp(),
            initial_correct_count = 4,
            retry_correct_count = 0,
            unresolved_wrong_count = 0,
            initial_score = 100,
            final_score = 100,
            passed = true,
            elapsed_seconds = 1
        where id = '00000000-0000-4000-8000-000000000505';
      `);
      const materialized = await sparseDatabase.query<{
        result: Array<{ status: string }>;
      }>(`
        select private.materialize_ready_vocab_assignment_queue_v1(
          '${ids.student}',
          10
        ) as result;
      `);
      const persisted = await sparseDatabase.query<{
        status: string;
        attention_reason: string | null;
        event_details: Record<string, unknown> | null;
        unit_ids: string[];
      }>(`
        select
          item.status::text as status,
          item.attention_reason,
          (
            select event.details
            from private.vocab_assignment_series_events as event
            where event.item_id = item.id
            order by event.occurred_at desc
            limit 1
          ) as event_details,
          array_agg(link.unit_id order by link.position)
            filter (where link.is_primary) as unit_ids
        from private.vocab_assignment_series_items as item
        join private.vocab_assignment_series as series
          on series.id = item.series_id
        left join public.assignment_units as link
          on link.assignment_id = item.assignment_id
        where series.request_id = '00000000-0000-4000-8000-000000000503'
          and item.sequence_number = 2
        group by item.id, item.status, item.attention_reason;
      `);
      expect(persisted.rows[0]).toEqual({
        status: "assigned",
        attention_reason: null,
        event_details: expect.any(Object),
        unit_ids: [ids.units[0], ids.units[4]],
      });
      expect(materialized.rows[0]?.result).toEqual([
        expect.objectContaining({ status: "assigned" }),
      ]);
      expect((await readExistingOverlapAssignments()).rows).toEqual(
        existingAssignmentsBeforeFollowUp.rows,
      );

      const weekdayRuleStudentId =
        "00000000-0000-4000-8000-000000000006";
      const weekdayRuleRequestId =
        "00000000-0000-4000-8000-000000000951";
      const weekdayRuleAttemptId =
        "00000000-0000-4000-8000-000000000952";
      await sparseDatabase.exec(`
        insert into public.students (
          id,
          display_name,
          status,
          created_by
        ) values (
          '${weekdayRuleStudentId}',
          'Weekday rule student',
          'active',
          '${ids.admin}'
        );
      `);

      const dayFiveQuestions = [2, 3, 4, 5].map(
        (vocabEntryId, index) => ({
          vocab_entry_id: vocabEntryId,
          base_order_index: index + 1,
          direction: "english_to_korean",
          choice_vocab_entry_ids: [2, 3, 4, 5],
        }),
      );
      const weekdayRuleWindows = [
        {
          from: "2030-01-01T00:00:00.000Z",
          until: "2030-01-01T14:00:00.000Z",
        },
        {
          from: "2030-01-03T00:00:00.000Z",
          until: "2030-01-03T14:00:00.000Z",
        },
      ];
      const makeWeekdayRuleBatch = (input: {
        title: string;
        sessionNumber: number;
        unitIds: readonly string[];
        unitLabels: readonly string[];
        questions: readonly Record<string, unknown>[];
      }) => ({
        ...makeBatch(
          input.title,
          weekdayRuleWindows[input.sessionNumber - 1]!.from,
          weekdayRuleWindows[input.sessionNumber - 1]!.until,
          input.sessionNumber,
          2,
        ),
        student_id: weekdayRuleStudentId,
        unit_ids: [...input.unitIds],
        unit_labels: [...input.unitLabels],
        questions: [...input.questions],
      });
      const weekdayUnitAllocationRule = {
        schema_version: 1,
        mode: "by_weekday",
        units_per_session: 1,
        weekday_units_per_session: [
          { isodow: 1, unit_count: 1 },
          { isodow: 2, unit_count: 2 },
          { isodow: 3, unit_count: 1 },
          { isodow: 4, unit_count: 3 },
          { isodow: 5, unit_count: 1 },
          { isodow: 6, unit_count: 1 },
          { isodow: 7, unit_count: 1 },
        ],
        base_session_unit_counts: [2, 3],
        ordered_unit_ids: [...ids.units],
        overflow_policy: "leave",
        extra_date_policy: "unconfirmed",
      };
      const weekdayRulePayload = [{
        student_id: weekdayRuleStudentId,
        dataset_id: ids.dataset,
        dataset_label: "Final schema test",
        range_label: "DAY 1~5",
        split_basis: "range_unit",
        resolved_plan_sha256: "e".repeat(64),
        recurrence_slots: [
          { isodow: 2, local_time: "09:00:00", duration_seconds: 50400 },
          { isodow: 4, local_time: "09:00:00", duration_seconds: 50400 },
        ],
        allocation_rule: weekdayUnitAllocationRule,
        items: [
          makeWeekdayRuleBatch({
            title: "Weekday rule 1",
            sessionNumber: 1,
            unitIds: ids.units.slice(0, 2),
            unitLabels: ["DAY 1", "DAY 2"],
            questions: JSON.parse(mixedQuestions),
          }),
          makeWeekdayRuleBatch({
            title: "Weekday rule 2",
            sessionNumber: 2,
            unitIds: ids.units.slice(2, 5),
            unitLabels: ["DAY 3", "DAY 4", "DAY 5"],
            questions: dayFiveQuestions,
          }),
        ],
      }];

      type QueueCreateResult = {
        student_id: string;
        assignment_id: string | null;
        session_number: number;
        status: string;
      };
      const createQueueV3 = async (input: {
        requestId: string;
        requestHash: string;
        payload: readonly unknown[];
      }) => {
        await sparseDatabase.exec("set role authenticated;");
        try {
        const created = await sparseDatabase.query<{
            result: QueueCreateResult[];
        }>(`
          select public.create_vocab_assignment_queues_v3(
              '${input.requestId}',
              '${input.requestHash}',
              $series$${JSON.stringify(input.payload)}$series$::jsonb
          ) as result;
        `);
          return created.rows[0]?.result ?? [];
        } finally {
          await sparseDatabase.exec("reset role;");
        }
      };
      const weekdayRuleCreated = await createQueueV3({
        requestId: weekdayRuleRequestId,
        requestHash: "f".repeat(64),
        payload: weekdayRulePayload,
      });

      expect(weekdayRuleCreated).toEqual([
        expect.objectContaining({
          student_id: weekdayRuleStudentId,
          assignment_id: expect.any(String),
          session_number: 1,
          status: "assigned",
        }),
        expect.objectContaining({
          student_id: weekdayRuleStudentId,
          assignment_id: null,
          session_number: 2,
          status: "queued",
        }),
      ]);
      const firstWeekdayRuleAssignmentId =
        weekdayRuleCreated[0]?.assignment_id;
      expect(firstWeekdayRuleAssignmentId).toBeTruthy();

      const readWeekdayRuleReplaySnapshot = () => sparseDatabase.query<{
        item_count: number;
        assignment_count: number;
        event_count: number;
        series_updated_at: string;
        assignment_updated_at: string;
      }>(`
        select
          (
            select count(*)::integer
            from private.vocab_assignment_series_items as item
            join private.vocab_assignment_series as series
              on series.id = item.series_id
            where series.request_id = '${weekdayRuleRequestId}'
          ) as item_count,
          (
            select count(distinct assignment.id)::integer
            from public.assignments as assignment
            join private.vocab_assignment_series_items as item
              on item.assignment_id = assignment.id
            join private.vocab_assignment_series as series
              on series.id = item.series_id
            where series.request_id = '${weekdayRuleRequestId}'
          ) as assignment_count,
          (
            select count(*)::integer
            from private.vocab_assignment_series_events as event
            join private.vocab_assignment_series as series
              on series.id = event.series_id
            where series.request_id = '${weekdayRuleRequestId}'
          ) as event_count,
          (
            select max(series.updated_at)::text
            from private.vocab_assignment_series as series
            where series.request_id = '${weekdayRuleRequestId}'
          ) as series_updated_at,
          (
            select max(assignment.updated_at)::text
            from public.assignments as assignment
            join private.vocab_assignment_series_items as item
              on item.assignment_id = assignment.id
            join private.vocab_assignment_series as series
              on series.id = item.series_id
            where series.request_id = '${weekdayRuleRequestId}'
          ) as assignment_updated_at;
      `);
      const replaySnapshot = await readWeekdayRuleReplaySnapshot();
      expect(await createQueueV3({
        requestId: weekdayRuleRequestId,
        requestHash: "f".repeat(64),
        payload: weekdayRulePayload,
      })).toEqual(weekdayRuleCreated);
      expect((await readWeekdayRuleReplaySnapshot()).rows).toEqual(
        replaySnapshot.rows,
      );

      const changedRulePayload = structuredClone(weekdayRulePayload);
      changedRulePayload[0]!.allocation_rule.overflow_policy =
        "continue_weekly";
      await expectPostgresError(
        createQueueV3({
          requestId: weekdayRuleRequestId,
          requestHash: "f".repeat(64),
          payload: changedRulePayload,
        }),
        "23505",
        "idempotency_key_reused",
      );
      const changedPlanPayload = structuredClone(weekdayRulePayload);
      changedPlanPayload[0]!.resolved_plan_sha256 = "d".repeat(64);
      await expectPostgresError(
        createQueueV3({
          requestId: weekdayRuleRequestId,
          requestHash: "f".repeat(64),
          payload: changedPlanPayload,
        }),
        "23505",
        "idempotency_key_reused",
      );
      expect((await readWeekdayRuleReplaySnapshot()).rows).toEqual(
        replaySnapshot.rows,
      );

      const storedWeekdayRule = await sparseDatabase.query<{
        resolved_plan_sha256: string;
        split_basis: string;
        allocation_rule: Record<string, unknown>;
        allocation_rule_sha256: string;
      }>(`
        select
          request.resolved_plan_sha256,
          series.split_basis,
          series.allocation_rule,
          series.allocation_rule_sha256
        from private.vocab_assignment_series as series
        join private.vocab_assignment_queue_requests as request
          on request.idempotency_key = series.request_id
        where series.request_id = '${weekdayRuleRequestId}';
      `);
      expect(storedWeekdayRule.rows[0]).toEqual({
        resolved_plan_sha256: "e".repeat(64),
        split_basis: "range_unit",
        allocation_rule: weekdayUnitAllocationRule,
        allocation_rule_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });

      const weekdayItemsBeforeCompletion = await sparseDatabase.query<{
        sequence_number: number;
        status: string;
        assignment_id: string | null;
        unit_ids: string[];
      }>(`
        select
          item.sequence_number,
          item.status::text as status,
          item.assignment_id,
          item.unit_ids
        from private.vocab_assignment_series_items as item
        join private.vocab_assignment_series as series
          on series.id = item.series_id
        where series.request_id = '${weekdayRuleRequestId}'
        order by item.sequence_number;
      `);
      expect(weekdayItemsBeforeCompletion.rows).toEqual([
        {
          sequence_number: 1,
          status: "assigned",
          assignment_id: firstWeekdayRuleAssignmentId,
          unit_ids: ids.units.slice(0, 2),
        },
        {
          sequence_number: 2,
          status: "queued",
          assignment_id: null,
          unit_ids: ids.units.slice(2, 5),
        },
      ]);

      await sparseDatabase.exec(`
        insert into public.quiz_attempts (
          id,
          student_id,
          assignment_id,
          attempt_number,
          status,
          phase,
          started_at,
          deadline_at,
          question_count_snapshot,
          time_limit_seconds_snapshot,
          passing_score_snapshot,
          passing_basis_snapshot
        ) values (
          '${weekdayRuleAttemptId}',
          '${weekdayRuleStudentId}',
          '${firstWeekdayRuleAssignmentId}',
          1,
          'in_progress',
          'initial',
          clock_timestamp(),
          clock_timestamp() + interval '1 hour',
          4,
          300,
          80,
          'initial'
        );

        update public.quiz_attempts
        set status = 'completed',
            phase = 'completed',
            initial_completed_at = clock_timestamp(),
            completed_at = clock_timestamp(),
            initial_correct_count = 4,
            retry_correct_count = 0,
            unresolved_wrong_count = 0,
            initial_score = 100,
            final_score = 100,
            passed = true,
            elapsed_seconds = 1
        where id = '${weekdayRuleAttemptId}';
      `);

      const weekdayItemsReady = await sparseDatabase.query<{
        sequence_number: number;
        status: string;
        completed_attempt_id: string | null;
      }>(`
        select
          item.sequence_number,
          item.status::text as status,
          item.completed_attempt_id
        from private.vocab_assignment_series_items as item
        join private.vocab_assignment_series as series
          on series.id = item.series_id
        where series.request_id = '${weekdayRuleRequestId}'
        order by item.sequence_number;
      `);
      expect(weekdayItemsReady.rows).toEqual([
        {
          sequence_number: 1,
          status: "completed",
          completed_attempt_id: weekdayRuleAttemptId,
        },
        {
          sequence_number: 2,
          status: "ready",
          completed_attempt_id: null,
        },
      ]);

      const weekdayMaterialized = await sparseDatabase.query<{
        result: Array<{ assignment_id: string; status: string }>;
      }>(`
        select private.materialize_ready_vocab_assignment_queue_v1(
          '${weekdayRuleStudentId}',
          10
        ) as result;
      `);
      expect(weekdayMaterialized.rows[0]?.result).toEqual([
        expect.objectContaining({
          assignment_id: expect.any(String),
          status: "assigned",
        }),
      ]);
      const secondWeekdayRuleAssignmentId =
        weekdayMaterialized.rows[0]?.result[0]?.assignment_id;
      expect(secondWeekdayRuleAssignmentId).toBeTruthy();

      const materializedWeekdayItem = await sparseDatabase.query<{
        assignment_id: string;
        status: string;
        unit_ids: string[];
        allocation_rule: Record<string, unknown>;
        allocation_rule_sha256: string;
      }>(`
        select
          item.assignment_id,
          item.status::text as status,
          array_agg(link.unit_id order by link.position)
            filter (where link.is_primary) as unit_ids,
          series.allocation_rule,
          series.allocation_rule_sha256
        from private.vocab_assignment_series_items as item
        join private.vocab_assignment_series as series
          on series.id = item.series_id
        join public.assignment_units as link
          on link.assignment_id = item.assignment_id
        where series.request_id = '${weekdayRuleRequestId}'
          and item.sequence_number = 2
        group by
          item.assignment_id,
          item.status,
          series.allocation_rule,
          series.allocation_rule_sha256;
      `);
      expect(materializedWeekdayItem.rows[0]).toEqual({
        assignment_id: secondWeekdayRuleAssignmentId,
        status: "assigned",
        unit_ids: ids.units.slice(2, 5),
        allocation_rule: weekdayUnitAllocationRule,
        allocation_rule_sha256:
          storedWeekdayRule.rows[0]!.allocation_rule_sha256,
      });

      const readableWeekdayRule = await sparseDatabase.query<{
        assignment_id: string;
        allocation_rule: Record<string, unknown>;
      }>(`
        select *
        from public.list_vocab_assignment_unit_rules_v1(
          array['${secondWeekdayRuleAssignmentId}'::uuid]
        );
      `);
      expect(readableWeekdayRule.rows[0]).toEqual({
        assignment_id: secondWeekdayRuleAssignmentId,
        allocation_rule: weekdayUnitAllocationRule,
      });
      const readableWeekdaySummary = await sparseDatabase.query<{
        allocation_rule: Record<string, unknown>;
        recurrence_weekdays: number[];
      }>(`
        select allocation_rule, recurrence_weekdays
        from public.list_vocab_assignment_queue_summaries_v2(
          false,
          '${weekdayRuleStudentId}',
          null,
          null,
          null
        );
      `);
      expect(readableWeekdaySummary.rows[0]).toEqual({
        allocation_rule: weekdayUnitAllocationRule,
        recurrence_weekdays: [2, 4],
      });

      const weekdayRuleEvents = await sparseDatabase.query<{
        completed_count: number;
        ready_count: number;
        second_assigned_count: number;
      }>(`
        select
          count(*) filter (
            where event.event_kind = 'session.completed'
          )::integer as completed_count,
          count(*) filter (
            where event.event_kind = 'session.ready'
          )::integer as ready_count,
          count(*) filter (
            where event.event_kind = 'session.assigned'
              and event.details ->> 'sequenceNumber' = '2'
          )::integer as second_assigned_count
        from private.vocab_assignment_series_events as event
        join private.vocab_assignment_series as series
          on series.id = event.series_id
        where series.request_id = '${weekdayRuleRequestId}';
      `);
      expect(weekdayRuleEvents.rows[0]).toEqual({
        completed_count: 1,
        ready_count: 1,
        second_assigned_count: 1,
      });

      const boundaryRequestId =
        "00000000-0000-4000-8000-000000000953";
      const boundaryStudentIds = Array.from(
        { length: 31 },
        (_, index) =>
          `00000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`,
      );
      await sparseDatabase.exec(`
        insert into public.students (
          id,
          display_name,
          status,
          created_by
        ) values ${boundaryStudentIds.map((studentId, index) => `(
          '${studentId}',
          'Queue boundary ${index + 1}',
          'active',
          '${ids.admin}'
        )`).join(",")};
      `);
      const boundaryWindow = {
        from: "2031-01-06T00:00:00.000Z",
        until: "2031-01-06T14:00:00.000Z",
      };
      const boundaryPayload = boundaryStudentIds.map((studentId, index) => ({
        student_id: studentId,
        dataset_id: ids.dataset,
        dataset_label: "Final schema test",
        range_label: "DAY 1, DAY 5",
        split_basis: "question_count",
        resolved_plan_sha256: "9".repeat(64),
        recurrence_slots: [{
          isodow: 1,
          local_time: "09:00:00",
          duration_seconds: 50400,
        }],
        allocation_rule: null,
        items: [{
          ...makeBatch(
            `Queue boundary ${index + 1}`,
            boundaryWindow.from,
            boundaryWindow.until,
          ),
          student_id: studentId,
        }],
      }));
      const boundaryCreated = await createQueueV3({
        requestId: boundaryRequestId,
        requestHash: "8".repeat(64),
        payload: boundaryPayload,
      });
      expect(boundaryCreated).toHaveLength(31);
      expect(boundaryCreated.every((result) =>
        result.status === "assigned" && Boolean(result.assignment_id)
      )).toBe(true);

      const boundaryStored = await sparseDatabase.query<{
        request_count: number;
        series_count: number;
        item_count: number;
        assignment_count: number;
        distinct_assignment_count: number;
        assigned_event_count: number;
      }>(`
        select
          (
            select count(*)::integer
            from private.vocab_assignment_queue_requests
            where idempotency_key = '${boundaryRequestId}'
          ) as request_count,
          (
            select count(*)::integer
            from private.vocab_assignment_series
            where request_id = '${boundaryRequestId}'
          ) as series_count,
          (
            select count(*)::integer
            from private.vocab_assignment_series_items as item
            join private.vocab_assignment_series as series
              on series.id = item.series_id
            where series.request_id = '${boundaryRequestId}'
          ) as item_count,
          (
            select count(*)::integer
            from public.assignments as assignment
            join private.vocab_assignment_series_items as item
              on item.assignment_id = assignment.id
            join private.vocab_assignment_series as series
              on series.id = item.series_id
            where series.request_id = '${boundaryRequestId}'
          ) as assignment_count,
          (
            select count(distinct item.assignment_id)::integer
            from private.vocab_assignment_series_items as item
            join private.vocab_assignment_series as series
              on series.id = item.series_id
            where series.request_id = '${boundaryRequestId}'
          ) as distinct_assignment_count,
          (
            select count(*)::integer
            from private.vocab_assignment_series_events as event
            join private.vocab_assignment_series as series
              on series.id = event.series_id
            where series.request_id = '${boundaryRequestId}'
              and event.event_kind = 'session.assigned'
          ) as assigned_event_count;
      `);
      expect(boundaryStored.rows[0]).toEqual({
        request_count: 1,
        series_count: 31,
        item_count: 31,
        assignment_count: 31,
        distinct_assignment_count: 31,
        assigned_event_count: 31,
      });
    } finally {
      await sparseDatabase.close();
    }
  }, 60_000);

  it("keeps the deployment-window compatibility rollback executable", async () => {
    const rollbackDatabase = await createFinalSchemaDatabase();
    try {
      await rollbackDatabase.exec(lifecycleRollbackSql);
      const privileges = await rollbackDatabase.query<{
        legacy_mixed: boolean;
        current_mixed: boolean;
        legacy_regular: boolean;
        current_regular: boolean;
        retry_regular: boolean;
        retry_mixed: boolean;
        retry_exact: boolean;
        retry_replace: boolean;
        retry_bulk: boolean;
        retry_queue: boolean;
      }>(`
        select
          has_function_privilege(
            'authenticated',
            'public.create_mixed_review_assignment_v5(uuid,uuid,smallint[],integer,uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)',
            'execute'
          ) as legacy_mixed,
          has_function_privilege(
            'authenticated',
            'public.create_mixed_review_assignment_v6(uuid,uuid,smallint[],uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)',
            'execute'
          ) as current_mixed,
          has_function_privilege(
            'authenticated',
            'public.create_assignment_with_question_bank_v3(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],jsonb)',
            'execute'
          ) as legacy_regular,
          has_function_privilege(
            'authenticated',
            'public.create_assignment_with_delivery_v4(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],text,integer,jsonb)',
            'execute'
          ) as current_regular,
          has_function_privilege(
            'authenticated',
            'public.create_assignment_with_delivery_v7(text,uuid,uuid[],integer,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamp with time zone,uuid[],text,integer,jsonb)',
            'execute'
          ) as retry_regular,
          has_function_privilege(
            'authenticated',
            'public.create_mixed_review_assignment_v10(uuid,uuid,smallint[],text,uuid[],text,uuid[],smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)',
            'execute'
          ) as retry_mixed,
          has_function_privilege(
            'authenticated',
            'public.create_exact_review_assignment_v7(uuid,uuid,uuid[],text,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)',
            'execute'
          ) as retry_exact,
          has_function_privilege(
            'authenticated',
            'public.replace_student_assignment_v5(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)',
            'execute'
          ) as retry_replace,
          has_function_privilege(
            'authenticated',
            'public.create_bulk_vocab_assignments_v9(uuid,text,jsonb)',
            'execute'
          ) as retry_bulk,
          has_function_privilege(
            'authenticated',
            'public.create_vocab_assignment_queues_v2(uuid,text,jsonb)',
            'execute'
          ) as retry_queue;
      `);
      expect(privileges.rows[0]).toEqual({
        legacy_mixed: true,
        current_mixed: false,
        legacy_regular: true,
        current_regular: false,
        retry_regular: false,
        retry_mixed: false,
        retry_exact: false,
        retry_replace: false,
        retry_bulk: false,
        retry_queue: false,
      });
    } finally {
      await rollbackDatabase.close();
    }
  }, 30_000);

  it("blocks the compatibility rollback after post-cutover activity", async () => {
    const rollbackDatabase = await createFinalSchemaDatabase();
    try {
      await rollbackDatabase.exec(`
        insert into public.audit_events (event_type)
        values ('test.post_cutover');
      `);

      await expectPostgresError(
        rollbackDatabase.exec(lifecycleRollbackSql),
        "P0001",
        "wrong_assignment_lifecycle_has_post_cutover_activity",
      );
    } finally {
      await rollbackDatabase.close();
    }
  }, 30_000);

  it("creates, blocks duplicates, cancels, and reassigns the full wrong-word union atomically", async () => {
    const lifecycleDatabase = await createFinalSchemaDatabase();
    try {
      await seedReviewAssignmentScenario(lifecycleDatabase);
      const extraQueueIds = [
        "00000000-0000-4000-8000-000000000311",
        "00000000-0000-4000-8000-000000000312",
        "00000000-0000-4000-8000-000000000313",
      ];
      const reviewOnlyQuestions = JSON.stringify([
        {
          vocab_entry_id: 1,
          base_order_index: 1,
          direction: "english_to_korean",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
        {
          vocab_entry_id: 2,
          base_order_index: 2,
          direction: "english_to_korean",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
        {
          vocab_entry_id: 3,
          base_order_index: 3,
          direction: "korean_to_english",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
        {
          vocab_entry_id: 4,
          base_order_index: 4,
          direction: "korean_to_english",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
      ]);
      const sourceAssignment = await lifecycleDatabase.query<{
        assignment_id: string;
      }>(`
        select private.create_assignment_with_question_bank_v3(
          'Queue source fixture',
          '${ids.dataset}',
          array['${ids.units[4]}']::uuid[],
          4,
          50::smallint,
          600,
          80::smallint,
          'fixed',
          null,
          array['${ids.student}']::uuid[],
          $questions$${reviewOnlyQuestions}$questions$::jsonb
        ) as assignment_id;
      `);
      const sourceAttempt = await lifecycleDatabase.query<{
        attempt_id: string;
      }>(`
        select public.create_quiz_attempt_from_bank(
          '${ids.student}',
          '${sourceAssignment.rows[0]?.assignment_id}'
        ) as attempt_id;
      `);
      const sourceAttemptId = sourceAttempt.rows[0]?.attempt_id;
      const sourceQuestions = await lifecycleDatabase.query<{
        id: string;
        vocab_entry_id: number;
      }>(`
        select id, vocab_entry_id
        from public.quiz_questions
        where attempt_id = '${sourceAttemptId}';
      `);
      const sourceQuestionByEntry = new Map(
        sourceQuestions.rows.map((question) => [
          question.vocab_entry_id,
          question.id,
        ]),
      );
      await lifecycleDatabase.exec(`
        update public.student_vocab_review_queue
        set
          status = 'cancelled',
          cancelled_at = clock_timestamp()
        where id = '${ids.overlappingQueue}';

        update public.student_vocab_review_queue
        set
          source_attempt_id = '${sourceAttemptId}',
          source_question_id = '${sourceQuestionByEntry.get(1)}'
        where id = '${ids.selectedQueue}';

        set session_replication_role = replica;
        insert into public.student_vocab_review_queue (
          id,
          student_id,
          dataset_id,
          vocab_entry_id,
          canonical_lexeme_id_snapshot,
          source_attempt_id,
          source_question_id,
          reason_level,
          status,
          queued_by,
          queued_at
        )
        values
          (
            '${extraQueueIds[0]}',
            '${ids.student}',
            '${ids.dataset}',
            2,
            '${ids.lexemes[1]}',
            '${sourceAttemptId}',
            '${sourceQuestionByEntry.get(2)}',
            1,
            'pending',
            '${ids.admin}',
            '2026-01-03T00:00:00Z'
          ),
          (
            '${extraQueueIds[1]}',
            '${ids.student}',
            '${ids.dataset}',
            3,
            '${ids.lexemes[2]}',
            '${sourceAttemptId}',
            '${sourceQuestionByEntry.get(3)}',
            1,
            'pending',
            '${ids.admin}',
            '2026-01-04T00:00:00Z'
          ),
          (
            '${extraQueueIds[2]}',
            '${ids.student}',
            '${ids.dataset}',
            4,
            '${ids.lexemes[3]}',
            '${sourceAttemptId}',
            '${sourceQuestionByEntry.get(4)}',
            1,
            'pending',
            '${ids.admin}',
            '2026-01-05T00:00:00Z'
          );
        set session_replication_role = origin;

        update public.assignments
        set status = 'closed'
        where id = '${sourceAssignment.rows[0]?.assignment_id}';
      `);

      const selectedQueueIds = [
        ids.selectedQueue,
        ...extraQueueIds,
      ];
      const createV6 = (title: string) =>
        lifecycleDatabase.query<{ assignment_id: string }>(`
          select public.create_mixed_review_assignment_v8(
            '${ids.student}',
            '${ids.dataset}',
            array[1]::smallint[],
            'dataset',
            array[
              ${selectedQueueIds
                .map((queueId) => `'${queueId}'::uuid`)
                .join(",")}
            ]::uuid[],
            '${title}',
            array[]::uuid[],
            50::smallint,
            600,
            80::smallint,
            'fixed',
            null,
            'total',
            null,
            $questions$${reviewOnlyQuestions}$questions$::jsonb
          ) as assignment_id;
        `);

      await lifecycleDatabase.exec("set role authenticated;");
      const firstResult = await createV6("All review union");
      await lifecycleDatabase.exec("reset role;");
      const firstAssignmentId = firstResult.rows[0]?.assignment_id;

      const createdState = await lifecycleDatabase.query<{
        assignment_purpose: string;
        question_count: number;
        pending_queue_count: number;
        active_target_count: number;
        primary_units: number;
        timing_mode: string;
      }>(`
        select
          assignment.assignment_purpose,
          assignment.question_count,
          (
            select count(*)::integer
            from public.student_vocab_review_queue as queue
            where queue.id = any(array[
              ${selectedQueueIds
                .map((queueId) => `'${queueId}'::uuid`)
                .join(",")}
            ]::uuid[])
              and queue.status = 'pending'
              and queue.consumed_assignment_id is null
          ) as pending_queue_count,
          (
            select count(*)::integer
            from public.assignment_review_targets as target
            where target.assignment_id = assignment.id
              and target.released_at is null
          ) as active_target_count,
          (
            select count(*)::integer
            from public.assignment_units as unit
            where unit.assignment_id = assignment.id
              and unit.is_primary
          ) as primary_units,
          assignment.timing_mode
        from public.assignments as assignment
        where assignment.id = '${firstAssignmentId}';
      `);
      expect(createdState.rows[0]).toEqual({
        assignment_purpose: "review",
        question_count: 4,
        pending_queue_count: 4,
        active_target_count: 4,
        primary_units: 0,
        timing_mode: "total",
      });

      await lifecycleDatabase.exec("set role authenticated;");
      await expectPostgresError(
        createV6("Duplicate must fail"),
        "40001",
        "mixed_review_queue_snapshot_changed",
      );
      await lifecycleDatabase.exec("reset role;");

      await lifecycleDatabase.exec("set role authenticated;");
      await lifecycleDatabase.query(`
        select public.cancel_student_assignment_v1(
          '${firstAssignmentId}',
          '${ids.student}',
          'integration cancellation'
        );
      `);
      await lifecycleDatabase.exec("reset role;");

      const cancelledState = await lifecycleDatabase.query<{
        cancelled: boolean;
        assignment_status: string;
        active_target_count: number;
        cancelled_target_count: number;
        pending_queue_count: number;
      }>(`
        select
          link.cancelled_at is not null as cancelled,
          assignment.status as assignment_status,
          (
            select count(*)::integer
            from public.assignment_review_targets as target
            where target.assignment_id = assignment.id
              and target.released_at is null
          ) as active_target_count,
          (
            select count(*)::integer
            from public.assignment_review_targets as target
            where target.assignment_id = assignment.id
              and target.release_reason = 'cancelled'
          ) as cancelled_target_count,
          (
            select count(*)::integer
            from public.student_vocab_review_queue as queue
            where queue.id = any(array[
              ${selectedQueueIds
                .map((queueId) => `'${queueId}'::uuid`)
                .join(",")}
            ]::uuid[])
              and queue.status = 'pending'
          ) as pending_queue_count
        from public.assignments as assignment
        join public.assignment_students as link
          on link.assignment_id = assignment.id
         and link.student_id = '${ids.student}'
        where assignment.id = '${firstAssignmentId}';
      `);
      expect(cancelledState.rows[0]).toEqual({
        cancelled: true,
        assignment_status: "closed",
        active_target_count: 0,
        cancelled_target_count: 4,
        pending_queue_count: 4,
      });

      await lifecycleDatabase.exec("set role authenticated;");
      const secondResult = await createV6("Reassigned after cancellation");
      const secondAssignmentId = secondResult.rows[0]?.assignment_id;
      await lifecycleDatabase.exec("reset role;");
      await lifecycleDatabase.query(`
        select public.create_quiz_attempt_from_bank(
          '${ids.student}',
          '${secondAssignmentId}'
        );
      `);
      await lifecycleDatabase.exec("set role authenticated;");
      await expectPostgresError(
        lifecycleDatabase.query(`
          select public.cancel_student_assignment_v1(
            '${secondAssignmentId}',
            '${ids.student}',
            'must reject after start'
          );
        `),
        "22023",
        "assignment_already_started",
      );
      await lifecycleDatabase.exec("reset role;");
    } finally {
      await lifecycleDatabase.close();
    }
  }, 30_000);

  it("creates regular assignments atomically and keeps active wrong targets reserved", async () => {
    const regularDatabase = await createFinalSchemaDatabase();
    try {
      await seedReviewAssignmentScenario(regularDatabase);
      const regularQuestions = JSON.stringify([
        {
          vocab_entry_id: 1,
          base_order_index: 1,
          direction: "english_to_korean",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
        {
          vocab_entry_id: 2,
          base_order_index: 2,
          direction: "english_to_korean",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
        {
          vocab_entry_id: 3,
          base_order_index: 3,
          direction: "korean_to_english",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
        {
          vocab_entry_id: 4,
          base_order_index: 4,
          direction: "korean_to_english",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
      ]);
      const createRegular = (
        title: string,
        timingMode = "total",
        questionTime: number | null = null,
      ) =>
        regularDatabase.query<{ assignment_id: string }>(`
          select public.create_assignment_with_delivery_v6(
            '${title}',
            '${ids.dataset}',
            array[
              '${ids.units[0]}'::uuid,
              '${ids.units[4]}'::uuid
            ],
            4,
            50::smallint,
            600,
            80::smallint,
            'fixed',
            null,
            array['${ids.student}']::uuid[],
            '${timingMode}',
            ${questionTime ?? "null"},
            $questions$${regularQuestions}$questions$::jsonb
          ) as assignment_id;
        `);

      await regularDatabase.exec("set role authenticated;");
      const first = await createRegular("Regular atomic");
      await regularDatabase.exec("reset role;");
      const firstAssignmentId = first.rows[0]?.assignment_id;
      const firstState = await regularDatabase.query<{
        timing_mode: string;
        active_targets: number;
      }>(`
        select
          assignment.timing_mode,
          (
            select count(*)::integer
            from public.assignment_review_targets as target
            where target.assignment_id = assignment.id
              and target.released_at is null
          ) as active_targets
        from public.assignments as assignment
        where assignment.id = '${firstAssignmentId}';
      `);
      expect(firstState.rows[0]).toEqual({
        timing_mode: "total",
        active_targets: 2,
      });

      await regularDatabase.exec("set role authenticated;");
      await expectPostgresError(
        createRegular("Regular duplicate"),
        "40001",
        "review_word_already_assigned",
      );
      await regularDatabase.query(`
        select public.cancel_student_assignment_v1(
          '${firstAssignmentId}',
          '${ids.student}',
          'regular integration cancellation'
        );
      `);
      await regularDatabase.exec("reset role;");

      await regularDatabase.exec("set role authenticated;");
      await expectPostgresError(
        createRegular("Invalid timing rollback", "per_question"),
        "22023",
        "invalid_timing_settings",
      );
      await regularDatabase.exec("reset role;");
      const rollbackState = await regularDatabase.query<{
        assignments: number;
        invalid_audits: number;
      }>(`
        select
          count(*)::integer as assignments,
          count(*) filter (
            where title = 'Invalid timing rollback'
          )::integer as invalid_audits
        from public.assignments;
      `);
      expect(rollbackState.rows[0]).toEqual({
        assignments: 1,
        invalid_audits: 0,
      });

      await regularDatabase.exec("set role authenticated;");
      const reassigned = await createRegular(
        "Regular reassigned",
        "per_question",
        30,
      );
      await regularDatabase.exec("reset role;");
      expect(reassigned.rows[0]?.assignment_id).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
    } finally {
      await regularDatabase.close();
    }
  }, 30_000);

  it("links one pending queue to the first repeated source occurrence", async () => {
    const occurrenceDatabase = await createFinalSchemaDatabase();
    try {
      await seedReviewAssignmentScenario(occurrenceDatabase);
      const questions = JSON.stringify([
        {
          vocab_entry_id: 2,
          base_order_index: 1,
          direction: "english_to_korean",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
        {
          vocab_entry_id: 5,
          base_order_index: 2,
          direction: "english_to_korean",
          choice_vocab_entry_ids: [1, 3, 4, 5],
        },
        {
          vocab_entry_id: 3,
          base_order_index: 3,
          direction: "korean_to_english",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
        {
          vocab_entry_id: 4,
          base_order_index: 4,
          direction: "korean_to_english",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
      ]);

      await occurrenceDatabase.exec("set role authenticated;");
      const assignment = await occurrenceDatabase.query<{
        assignment_id: string;
      }>(`
        select public.create_assignment_with_delivery_v6(
          'Repeated source occurrence',
          '${ids.dataset}',
          array['${ids.units[4]}'::uuid],
          4,
          50::smallint,
          600,
          80::smallint,
          'fixed',
          null,
          array['${ids.student}'::uuid],
          'total',
          null,
          $questions$${questions}$questions$::jsonb
        ) as assignment_id;
      `);
      await occurrenceDatabase.exec("reset role;");

      const state = await occurrenceDatabase.query<{
        question_count: number;
        target_count: number;
        target_vocab_entry_id: number;
      }>(`
        select
          (
            select count(*)::integer
            from public.assignment_questions as question
            where question.assignment_id = assignment.id
          ) as question_count,
          (
            select count(*)::integer
            from public.assignment_review_targets as target
            where target.assignment_id = assignment.id
              and target.student_id = '${ids.student}'
              and target.review_queue_id = '${ids.overlappingQueue}'
              and target.released_at is null
          ) as target_count,
          (
            select target.vocab_entry_id
            from public.assignment_review_targets as target
            where target.assignment_id = assignment.id
              and target.student_id = '${ids.student}'
              and target.review_queue_id = '${ids.overlappingQueue}'
              and target.released_at is null
          ) as target_vocab_entry_id
        from public.assignments as assignment
        where assignment.id = '${assignment.rows[0]?.assignment_id}';
      `);
      expect(state.rows[0]).toEqual({
        question_count: 4,
        target_count: 1,
        target_vocab_entry_id: 2,
      });
    } finally {
      await occurrenceDatabase.close();
    }
  }, 30_000);

  it("allows repeated regular headwords when they are not active wrong targets", async () => {
    const unlinkedDatabase = await createFinalSchemaDatabase();
    try {
      await seedReviewAssignmentScenario(unlinkedDatabase);
      await unlinkedDatabase.exec(`
        insert into public.vocab_entries (
          id,
          dataset_id,
          source_row,
          headword,
          headword_normalized,
          meanings,
          primary_meaning,
          source_ref,
          row_sha256,
          unit_id,
          position_in_unit,
          entry_type
        )
        overriding system value
        select
          entry_id,
          '${ids.dataset}',
          entry_id,
          case
            when entry_id = 6 then 'orphan-word'
            when entry_id = 7 then 'ORPHAN-WORD*'
            else 'fixture-' || entry_id
          end,
          case
            when entry_id in (6, 7) then 'orphan-word'
            else 'fixture-' || entry_id
          end,
          array[case
            when entry_id in (6, 7) then 'shared meaning'
            else 'fixture-' || entry_id
          end],
          case
            when entry_id in (6, 7) then 'shared meaning'
            else 'fixture-' || entry_id
          end,
          'unlinked fixture',
          upper(lpad(to_hex(entry_id), 64, '0')),
          '${ids.units[4]}',
          entry_id,
          'word'
        from generate_series(6, 13) as generated(entry_id);

        insert into public.vocab_entry_quiz_eligibility (
          vocab_entry_id,
          dataset_id,
          quiz_mode,
          status,
          input_content_hash,
          canonical_lexeme_id,
          canonical_content_hash,
          rule_version,
          evaluated_at_utc
        )
        select
          entry.id,
          entry.dataset_id,
          mode.quiz_mode,
          'eligible',
          entry.row_sha256,
          null,
          null,
          'unlinked-fixture-v1',
          clock_timestamp()
        from public.vocab_entries as entry
        cross join (
          values
            ('book_meaning_en_to_ko'),
            ('book_meaning_ko_to_en')
        ) as mode(quiz_mode)
        where entry.id between 6 and 13;
      `);

      const firstQuestions = JSON.stringify(
        [6, 7, 8, 9].map((vocabEntryId, index) => ({
          vocab_entry_id: vocabEntryId,
          base_order_index: index + 1,
          direction: "english_to_korean",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        })),
      );
      const secondQuestions = JSON.stringify(
        [7, 11, 12, 13].map((vocabEntryId, index) => ({
          vocab_entry_id: vocabEntryId,
          base_order_index: index + 1,
          direction: "english_to_korean",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        })),
      );
      const createAssignment = (title: string, questionsJson: string) =>
        unlinkedDatabase.query<{ assignment_id: string }>(`
          select public.create_assignment_with_delivery_v6(
            '${title}',
            '${ids.dataset}',
            array['${ids.units[4]}']::uuid[],
            4,
            100::smallint,
            600,
            80::smallint,
            'fixed',
            null,
            array['${ids.student}']::uuid[],
            'total',
            null,
            $questions$${questionsJson}$questions$::jsonb
          ) as assignment_id;
        `);

      await unlinkedDatabase.exec("set role authenticated;");
      const first = await createAssignment(
        "Unlinked headword first",
        firstQuestions,
      );
      const second = await createAssignment(
        "Unlinked headword duplicate",
        secondQuestions,
      );
      await unlinkedDatabase.exec("reset role;");

      expect(first.rows[0]?.assignment_id).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
      expect(second.rows[0]?.assignment_id).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
      const attempt = await unlinkedDatabase.query<{
        attempt_id: string;
      }>(`
        select public.create_quiz_attempt_from_bank(
          '${ids.student}',
          '${second.rows[0]?.assignment_id}'
        ) as attempt_id;
      `);
      const attemptQuestion = await unlinkedDatabase.query<{
        id: string;
      }>(`
        select id
        from public.quiz_questions
        where attempt_id = '${attempt.rows[0]?.attempt_id}'
          and vocab_entry_id = 7;
      `);
      await unlinkedDatabase.exec(`
        insert into public.student_vocab_state (
          student_id,
          vocab_entry_id,
          unresolved_wrong_count,
          last_wrong_at,
          resolved_at,
          last_attempt_id,
          last_evaluated_at
        )
        values (
          '${ids.student}',
          6,
          1,
          '2029-01-01T00:00:00Z',
          null,
          '${attempt.rows[0]?.attempt_id}',
          '2029-01-01T00:00:00Z'
        );

        insert into public.student_vocab_review_queue (
          id,
          student_id,
          dataset_id,
          vocab_entry_id,
          canonical_lexeme_id_snapshot,
          source_attempt_id,
          source_question_id,
          reason_level,
          status,
          queued_by
        )
        values (
          '00000000-0000-4000-8000-000000000399',
          '${ids.student}',
          '${ids.dataset}',
          6,
          null,
          '${attempt.rows[0]?.attempt_id}',
          '${attemptQuestion.rows[0]?.id}',
          1,
          'pending',
          '${ids.admin}'
        );

        update public.quiz_questions
        set
          initial_choice_index = 0,
          initial_is_correct = true,
          initial_answered_at = '2030-01-01T00:00:00Z'
        where id = '${attemptQuestion.rows[0]?.id}';
      `);
      const resolvedUnlinked = await unlinkedDatabase.query<{
        unresolved_wrong_count: number;
        queue_status: string;
      }>(`
        select
          state.unresolved_wrong_count,
          queue.status as queue_status
        from public.student_vocab_state as state
        join public.student_vocab_review_queue as queue
          on queue.id =
            '00000000-0000-4000-8000-000000000399'
        where state.student_id = '${ids.student}'
          and state.vocab_entry_id = 6;
      `);
      expect(resolvedUnlinked.rows[0]).toEqual({
        unresolved_wrong_count: 0,
        queue_status: "cancelled",
      });
    } finally {
      await unlinkedDatabase.close();
    }
  }, 30_000);

  it("resolves canonical aliases together without letting an older answer erase newer wrong state", async () => {
    const resolutionDatabase = await createFinalSchemaDatabase();
    try {
      await seedReviewAssignmentScenario(resolutionDatabase);
      const questions = JSON.stringify([
        {
          vocab_entry_id: 1,
          base_order_index: 1,
          direction: "english_to_korean",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
        {
          vocab_entry_id: 2,
          base_order_index: 2,
          direction: "english_to_korean",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
        {
          vocab_entry_id: 3,
          base_order_index: 3,
          direction: "korean_to_english",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
        {
          vocab_entry_id: 4,
          base_order_index: 4,
          direction: "korean_to_english",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
      ]);

      await resolutionDatabase.exec("set role authenticated;");
      const assignment = await resolutionDatabase.query<{
        assignment_id: string;
      }>(`
        select public.create_assignment_with_delivery_v6(
          'Canonical resolution',
          '${ids.dataset}',
          array[
            '${ids.units[0]}'::uuid,
            '${ids.units[4]}'::uuid
          ],
          4,
          50::smallint,
          600,
          80::smallint,
          'fixed',
          null,
          array['${ids.student}']::uuid[],
          'total',
          null,
          $questions$${questions}$questions$::jsonb
        ) as assignment_id;
      `);
      await resolutionDatabase.exec("reset role;");
      const attempt = await resolutionDatabase.query<{
        attempt_id: string;
      }>(`
        select public.create_quiz_attempt_from_bank(
          '${ids.student}',
          '${assignment.rows[0]?.assignment_id}'
        ) as attempt_id;
      `);
      const attemptId = attempt.rows[0]?.attempt_id;

      await resolutionDatabase.exec(`
        update public.student_vocab_review_queue
        set
          source_attempt_id = '${attemptId}',
          source_question_id = (
            select id
            from public.quiz_questions
            where attempt_id = '${attemptId}'
              and vocab_entry_id = 2
          )
        where id = '${ids.overlappingQueue}';

        insert into public.student_vocab_state (
          student_id,
          vocab_entry_id,
          unresolved_wrong_count,
          last_wrong_at,
          resolved_at,
          last_attempt_id,
          last_evaluated_at
        )
        values
          (
            '${ids.student}',
            2,
            1,
            '2030-01-01T00:00:00Z',
            null,
            '${attemptId}',
            '2030-01-01T00:00:00Z'
          ),
          (
            '${ids.student}',
            5,
            1,
            '2030-01-01T00:00:00Z',
            null,
            '${attemptId}',
            '2030-01-01T00:00:00Z'
          )
        on conflict (student_id, vocab_entry_id)
        do update set
          unresolved_wrong_count = excluded.unresolved_wrong_count,
          last_wrong_at = excluded.last_wrong_at,
          resolved_at = null,
          last_attempt_id = excluded.last_attempt_id,
          last_evaluated_at = excluded.last_evaluated_at;

        update public.quiz_questions
        set
          initial_choice_index = 0,
          initial_is_correct = true,
          initial_answered_at = '2029-01-01T00:00:00Z'
        where attempt_id = '${attemptId}'
          and vocab_entry_id = 2;
      `);
      const staleAnswerState = await resolutionDatabase.query<{
        unresolved_entries: number;
        queue_status: string;
        active_target: number;
      }>(`
        select
          (
            select count(*)::integer
            from public.student_vocab_state
            where student_id = '${ids.student}'
              and vocab_entry_id in (2, 5)
              and unresolved_wrong_count > 0
          ) as unresolved_entries,
          (
            select status
            from public.student_vocab_review_queue
            where id = '${ids.overlappingQueue}'
          ) as queue_status,
          (
            select count(*)::integer
            from public.assignment_review_targets
            where assignment_id = '${assignment.rows[0]?.assignment_id}'
              and canonical_lexeme_id_snapshot = '${ids.lexemes[1]}'
              and released_at is null
          ) as active_target;
      `);
      expect(staleAnswerState.rows[0]).toEqual({
        unresolved_entries: 2,
        queue_status: "pending",
        active_target: 1,
      });

      await resolutionDatabase.exec(`
        update public.quiz_questions
        set
          retry_choice_index = 0,
          retry_is_correct = true,
          retry_answered_at = '2031-01-01T00:00:00Z'
        where attempt_id = '${attemptId}'
          and vocab_entry_id = 2;
      `);
      const resolvedState = await resolutionDatabase.query<{
        resolved_entries: number;
        queue_status: string;
        released_target: number;
      }>(`
        select
          (
            select count(*)::integer
            from public.student_vocab_state
            where student_id = '${ids.student}'
              and vocab_entry_id in (2, 5)
              and unresolved_wrong_count = 0
              and resolved_at = '2031-01-01T00:00:00Z'
          ) as resolved_entries,
          (
            select status
            from public.student_vocab_review_queue
            where id = '${ids.overlappingQueue}'
          ) as queue_status,
          (
            select count(*)::integer
            from public.assignment_review_targets
            where assignment_id = '${assignment.rows[0]?.assignment_id}'
              and canonical_lexeme_id_snapshot = '${ids.lexemes[1]}'
              and release_reason = 'resolved'
          ) as released_target;
      `);
      expect(resolvedState.rows[0]).toEqual({
        resolved_entries: 2,
        queue_status: "cancelled",
        released_target: 1,
      });
    } finally {
      await resolutionDatabase.close();
    }
  }, 30_000);

  it("keeps mixed queue consumption and exact-review regression atomic", async () => {
    await seedReviewAssignmentScenario(database);

    const createMixed = (
      title = "Mixed assignment",
      availableUntil = "null",
    ) =>
      database.query<{ assignment_id: string }>(`
        select public.create_mixed_review_assignment_v5(
          '${ids.student}',
          '${ids.dataset}',
          array[1]::smallint[],
          1,
          array['${ids.selectedQueue}']::uuid[],
          '${title}',
          array['${ids.units[4]}']::uuid[],
          100::smallint,
          600,
          80::smallint,
          'fixed',
          ${availableUntil},
          $questions$${mixedQuestions}$questions$::jsonb
        ) as assignment_id;
      `);

    await database.exec("set role anon;");
    await expectPostgresError(
      createMixed(),
      "42501",
      "permission denied",
    );
    await database.exec("reset role; set role authenticated;");

    await expectPostgresError(
      createMixed(),
      "42501",
      "permission denied",
    );
    await expectPostgresError(
      database.query(`
        select public.create_exact_review_assignment_v4(
          '${ids.exactDraft}',
          'Retired exact review',
          100::smallint,
          600,
          80::smallint,
          'fixed',
          null,
          '[]'::jsonb
        );
      `),
      "42501",
      "permission denied",
    );
    await database.exec("reset role;");
    return;

    const rollbackState = await database.query<{
      assignments: number;
      pending_queues: number;
    }>(`
      select
        (select count(*)::integer from public.assignments)
          as assignments,
        (
          select count(*)::integer
          from public.student_vocab_review_queue
          where status = 'pending'
        ) as pending_queues;
    `);
    expect(rollbackState.rows[0]).toEqual({
      assignments: 0,
      pending_queues: 2,
    });

    await database.exec(`
      update public.student_vocab_review_queue
      set
        status = 'cancelled',
        cancelled_at = clock_timestamp()
      where id = '${ids.overlappingQueue}';
    `);

    await database.exec("set role authenticated;");
    await expectPostgresError(
      createMixed(
        "Post-consume rollback",
        "clock_timestamp() + interval '50 milliseconds'",
      ),
      "22023",
      "assignment_deadline_elapsed_during_review_creation",
    );
    await database.exec("reset role;");

    const postConsumeRollback = await database.query<{
      assignments: number;
      queue_status: string;
      consume_audits: number;
    }>(`
      select
        (select count(*)::integer from public.assignments)
          as assignments,
        (
          select status
          from public.student_vocab_review_queue
          where id = '${ids.selectedQueue}'
        ) as queue_status,
        (
          select count(*)::integer
          from public.audit_events
          where event_type = 'assignment.review_queue_consumed'
        ) as consume_audits;
    `);
    expect(postConsumeRollback.rows[0]).toEqual({
      assignments: 0,
      queue_status: "pending",
      consume_audits: 0,
    });

    await database.exec("set role authenticated;");
    const mixedResult = await createMixed();
    await database.exec("reset role;");
    const mixedAssignmentId = mixedResult.rows[0]?.assignment_id;
    expect(mixedAssignmentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const mixedState = await database.query<{
      assignment_purpose: string;
      support_units: number;
      primary_units: number;
      queue_status: string;
      queue_assignment_id: string | null;
    }>(`
      select
        assignment.assignment_purpose,
        (
          select count(*)::integer
          from public.assignment_units as unit
          where unit.assignment_id = assignment.id
        ) as support_units,
        (
          select count(*)::integer
          from public.assignment_units as unit
          where unit.assignment_id = assignment.id
            and unit.is_primary
        ) as primary_units,
        queue.status as queue_status,
        queue.consumed_assignment_id::text as queue_assignment_id
      from public.assignments as assignment
      join public.student_vocab_review_queue as queue
        on queue.id = '${ids.selectedQueue}'
      where assignment.id = '${mixedAssignmentId}';
    `);
    expect(mixedState.rows[0]).toEqual({
      assignment_purpose: "mixed",
      support_units: 5,
      primary_units: 1,
      queue_status: "consumed",
      queue_assignment_id: mixedAssignmentId,
    });

    await database.exec(`
      insert into public.student_vocab_review_assignment_drafts (
        id,
        student_id,
        dataset_id,
        status,
        created_by,
        expires_at
      )
      values
        (
          '${ids.exactDraft}',
          '${ids.student}',
          '${ids.dataset}',
          'pending',
          '${ids.admin}',
          clock_timestamp() + interval '1 hour'
        ),
        (
          '${ids.rollbackDraft}',
          '${ids.student}',
          '${ids.dataset}',
          'pending',
          '${ids.admin}',
          clock_timestamp() + interval '1 hour'
        );

      set session_replication_role = replica;
      insert into public.student_vocab_review_queue (
        id,
        student_id,
        dataset_id,
        vocab_entry_id,
        canonical_lexeme_id_snapshot,
        source_attempt_id,
        source_question_id,
        reason_level,
        status,
        queued_by,
        queued_at,
        reserved_review_draft_id,
        reserved_at
      )
      values
        (
          '${ids.exactQueue}',
          '${ids.student}',
          '${ids.dataset}',
          5,
          '${ids.lexemes[1]}',
          '00000000-0000-4000-8000-000000000503',
          '00000000-0000-4000-8000-000000000603',
          1,
          'pending',
          '${ids.admin}',
          '2026-01-03T00:00:00Z',
          '${ids.exactDraft}',
          clock_timestamp()
        ),
        (
          '${ids.rollbackQueue}',
          '${ids.student}',
          '${ids.dataset}',
          4,
          '${ids.lexemes[3]}',
          '00000000-0000-4000-8000-000000000504',
          '00000000-0000-4000-8000-000000000604',
          1,
          'pending',
          '${ids.admin}',
          '2026-01-04T00:00:00Z',
          '${ids.rollbackDraft}',
          clock_timestamp()
        );
      set session_replication_role = origin;

      insert into public.student_vocab_review_assignment_draft_items (
        draft_id,
        queue_id,
        position
      )
      values
        ('${ids.exactDraft}', '${ids.exactQueue}', 1),
        ('${ids.rollbackDraft}', '${ids.rollbackQueue}', 1);
    `);

    const exactQuestions = JSON.stringify([
      {
        vocab_entry_id: 5,
        base_order_index: 1,
        direction: "english_to_korean",
        choice_vocab_entry_ids: [5, 1, 3, 4],
      },
    ]);
    const wrongExactQuestions = JSON.stringify([
      {
        vocab_entry_id: 4,
        base_order_index: 1,
        direction: "english_to_korean",
        choice_vocab_entry_ids: [4, 1, 2, 3],
      },
    ]);

    await database.exec("set role authenticated;");
    await expectPostgresError(
      database.query(`
        select public.create_exact_review_assignment_v4(
          '${ids.rollbackDraft}',
          'Post-consume rollback',
          100::smallint,
          600,
          80::smallint,
          'fixed',
          clock_timestamp() + interval '50 milliseconds',
          $questions$${wrongExactQuestions}$questions$::jsonb
        );
      `),
      "22023",
      "assignment_deadline_elapsed_during_review_creation",
    );
    await database.exec("reset role;");

    await database.exec("set role authenticated;");
    const exactResult = await database.query<{
      assignment_id: string;
    }>(`
      select public.create_exact_review_assignment_v4(
        '${ids.exactDraft}',
        'Exact review',
        100::smallint,
        600,
        80::smallint,
        'fixed',
        null,
        $questions$${exactQuestions}$questions$::jsonb
      ) as assignment_id;
    `);
    await database.exec("reset role;");
    const exactAssignmentId = exactResult.rows[0]?.assignment_id;

    const exactState = await database.query<{
      assignment_purpose: string;
      primary_units: number;
      queue_status: string;
      draft_status: string;
      rollback_queue_status: string;
      rollback_draft_status: string;
    }>(`
      select
        assignment.assignment_purpose,
        (
          select count(*)::integer
          from public.assignment_units as unit
          where unit.assignment_id = assignment.id
            and unit.is_primary
        ) as primary_units,
        exact_queue.status as queue_status,
        exact_draft.status as draft_status,
        rollback_queue.status as rollback_queue_status,
        rollback_draft.status as rollback_draft_status
      from public.assignments as assignment
      join public.student_vocab_review_queue as exact_queue
        on exact_queue.id = '${ids.exactQueue}'
      join public.student_vocab_review_assignment_drafts
        as exact_draft
        on exact_draft.id = '${ids.exactDraft}'
      join public.student_vocab_review_queue as rollback_queue
        on rollback_queue.id = '${ids.rollbackQueue}'
      join public.student_vocab_review_assignment_drafts
        as rollback_draft
        on rollback_draft.id = '${ids.rollbackDraft}'
      where assignment.id = '${exactAssignmentId}';
    `);
    expect(exactState.rows[0]).toEqual({
      assignment_purpose: "review",
      primary_units: 0,
      queue_status: "consumed",
      draft_status: "consumed",
      rollback_queue_status: "pending",
      rollback_draft_status: "pending",
    });

    const auditState = await database.query<{
      review_consumed: number;
      mixed_selected: number;
    }>(`
      select
        count(*) filter (
          where event_type = 'assignment.review_queue_consumed'
        )::integer as review_consumed,
        count(*) filter (
          where event_type = 'assignment.mixed_review_selected'
        )::integer as mixed_selected
      from public.audit_events;
    `);
    expect(auditState.rows[0]).toEqual({
      review_consumed: 2,
      mixed_selected: 1,
    });
  });

  it("aggregates pending and reserved counts without exposing them to anon", async () => {
    await database.exec(`
      update public.student_vocab_review_queue
      set
        status = 'cancelled',
        cancelled_at = clock_timestamp(),
        reserved_review_draft_id = null,
        reserved_at = null
      where student_id = '${ids.student}'
        and dataset_id = '${ids.dataset}'
        and status = 'pending';

      set session_replication_role = replica;
      insert into public.student_vocab_review_queue (
        id,
        student_id,
        dataset_id,
        vocab_entry_id,
        source_attempt_id,
        source_question_id,
        reason_level,
        status,
        queued_by,
        queued_at
      )
      values
        (
          '00000000-0000-4000-8000-000000000305',
          '${ids.student}',
          '${ids.dataset}',
          1,
          '00000000-0000-4000-8000-000000000505',
          '00000000-0000-4000-8000-000000000605',
          1,
          'pending',
          '${ids.admin}',
          '2026-01-05T00:00:00Z'
        ),
        (
          '00000000-0000-4000-8000-000000000306',
          '${ids.student}',
          '${ids.dataset}',
          2,
          '00000000-0000-4000-8000-000000000506',
          '00000000-0000-4000-8000-000000000606',
          2,
          'pending',
          '${ids.admin}',
          '2026-01-06T00:00:00Z'
        ),
        (
          '00000000-0000-4000-8000-000000000307',
          '00000000-0000-4000-8000-000000000007',
          '00000000-0000-4000-8000-000000000008',
          99,
          '00000000-0000-4000-8000-000000000507',
          '00000000-0000-4000-8000-000000000607',
          2,
          'pending',
          '${ids.admin}',
          '2026-01-07T00:00:00Z'
        );
      set session_replication_role = origin;
    `);

    await database.exec("set role anon;");
    await expectPostgresError(
      database.query(
        "select * from public.list_student_vocab_review_queue_summaries();",
      ),
      "42501",
      "permission denied",
    );
    await database.exec("reset role; set role authenticated;");
    const summaries = await database.query<{
      student_id: string;
      dataset_id: string;
      pending_level_1_count: number;
      pending_level_2_count: number;
      reserved_level_1_count: number;
      reserved_level_2_count: number;
    }>(`
      select *
      from public.list_student_vocab_review_queue_summaries()
      where student_id = '${ids.student}'
        and dataset_id = '${ids.dataset}';
    `);

    const firstPage = await database.query<{
      student_id: string;
      dataset_id: string;
    }>(`
      select student_id, dataset_id
      from public.list_student_vocab_review_queue_summaries(
        null,
        null,
        1
      );
    `);
    const secondPage = await database.query<{
      student_id: string;
      dataset_id: string;
    }>(`
      select student_id, dataset_id
      from public.list_student_vocab_review_queue_summaries(
        '${ids.student}',
        '${ids.dataset}',
        1
      );
    `);
    await database.exec("reset role;");

    expect(summaries.rows).toEqual([
      {
        student_id: ids.student,
        dataset_id: ids.dataset,
        pending_level_1_count: 1,
        pending_level_2_count: 1,
        reserved_level_1_count: 0,
        reserved_level_2_count: 0,
      },
    ]);
    expect(firstPage.rows).toEqual([
      {
        student_id: ids.student,
        dataset_id: ids.dataset,
      },
    ]);
    expect(secondPage.rows).toEqual([
      {
        student_id: "00000000-0000-4000-8000-000000000007",
        dataset_id: "00000000-0000-4000-8000-000000000008",
      },
    ]);
  });
});

describe.sequential("admin deletion controls", () => {
  it("keeps the no-activity rollback executable", async () => {
    const database = await createFinalSchemaDatabase();
    try {
      await database.exec(adminDeletionRollbackSql);
      const state = await database.query<{
        student_deleted_column: string | null;
        assignment_deleted_column: string | null;
        delete_student_rpc: string | null;
        hidden_history_table: string | null;
      }>(`
        select
          (
            select column_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'students'
              and column_name = 'deleted_at'
          ) as student_deleted_column,
          (
            select column_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'assignments'
              and column_name = 'deleted_at'
          ) as assignment_deleted_column,
          to_regprocedure(
            'public.delete_student_v1(uuid)'
          )::text as delete_student_rpc,
          to_regclass(
            'public.admin_history_hidden_entries'
          )::text as hidden_history_table;
      `);

      expect(state.rows[0]).toEqual({
        student_deleted_column: null,
        assignment_deleted_column: null,
        delete_student_rpc: null,
        hidden_history_table: null,
      });
    } finally {
      await database.close();
    }
  }, 30_000);

  it("soft-deletes a student while preserving attempts and cancelling only unstarted delivery", async () => {
    const database = await createFinalSchemaDatabase();
    try {
      await seedReviewAssignmentScenario(database);
      const unstartedAssignment =
        "00000000-0000-4000-8000-000000000701";
      const startedAssignment =
        "00000000-0000-4000-8000-000000000702";
      const attemptId =
        "00000000-0000-4000-8000-000000000703";
      const initialAssignment =
        "00000000-0000-4000-8000-000000000704";
      const initialAttemptId =
        "00000000-0000-4000-8000-000000000705";
      const peerStudent =
        "00000000-0000-4000-8000-000000000706";

      await database.exec(`
        insert into public.students (
          id,
          display_name,
          status,
          created_by
        )
        values (
          '${peerStudent}',
          'Peer student',
          'active',
          '${ids.admin}'
        );

        update public.students
        set code_generation = 1
        where id = '${ids.student}';

        insert into public.student_codes (
          student_id,
          lookup_hmac,
          encrypted_code,
          encryption_iv,
          encryption_tag,
          code_generation
        )
        values (
          '${ids.student}',
          repeat('A', 64),
          'encrypted',
          'iv',
          'tag',
          1
        );

        insert into public.student_sessions (
          student_id,
          token_hash,
          code_generation,
          expires_at
        )
        values (
          '${ids.student}',
          repeat('B', 64),
          1,
          clock_timestamp() + interval '1 day'
        );

        insert into public.assignments (
          id,
          title,
          dataset_id,
          range_start,
          range_end,
          question_count,
          english_to_korean_ratio,
          time_limit_seconds,
          passing_score,
          status,
          available_from,
          created_by,
          range_basis,
          question_order_mode,
          question_bank_version
        )
        values
          (
            '${unstartedAssignment}',
            'Unstarted fixture',
            '${ids.dataset}',
            1,
            1,
            1,
            100,
            60,
            80,
            'active',
            clock_timestamp(),
            '${ids.admin}',
            'units',
            'fixed',
            1
          ),
          (
            '${startedAssignment}',
            'Started fixture',
            '${ids.dataset}',
            1,
            1,
            1,
            100,
            60,
            80,
            'active',
            clock_timestamp(),
            '${ids.admin}',
            'units',
            'fixed',
            1
          ),
          (
            '${initialAssignment}',
            'Initial attempt fixture',
            '${ids.dataset}',
            1,
            1,
            1,
            100,
            60,
            80,
            'active',
            clock_timestamp(),
            '${ids.admin}',
            'units',
            'fixed',
            1
          );

        insert into public.assignment_units (
          assignment_id,
          dataset_id,
          unit_id,
          position,
          is_primary
        )
        values
          (
            '${unstartedAssignment}',
            '${ids.dataset}',
            '${ids.units[0]}',
            1,
            true
          ),
          (
            '${startedAssignment}',
            '${ids.dataset}',
            '${ids.units[0]}',
            1,
            true
          ),
          (
            '${initialAssignment}',
            '${ids.dataset}',
            '${ids.units[0]}',
            1,
            true
          );

        insert into public.assignment_students (
          assignment_id,
          student_id,
          assigned_by
        )
        values
          (
            '${unstartedAssignment}',
            '${ids.student}',
            '${ids.admin}'
          ),
          (
            '${startedAssignment}',
            '${ids.student}',
            '${ids.admin}'
          ),
          (
            '${initialAssignment}',
            '${ids.student}',
            '${ids.admin}'
          ),
          (
            '${unstartedAssignment}',
            '${peerStudent}',
            '${ids.admin}'
          );

        insert into public.quiz_attempts (
          id,
          student_id,
          assignment_id,
          attempt_number,
          status,
          phase,
          started_at,
          deadline_at,
          initial_completed_at,
          question_count_snapshot,
          time_limit_seconds_snapshot,
          passing_score_snapshot,
          passing_basis_snapshot,
          initial_correct_count,
          retry_correct_count,
          unresolved_wrong_count,
          initial_score,
          elapsed_seconds
        )
        values (
          '${attemptId}',
          '${ids.student}',
          '${startedAssignment}',
          1,
          'in_progress',
          'review',
          clock_timestamp(),
          clock_timestamp() + interval '1 hour',
          clock_timestamp(),
          1,
          60,
          80,
          'initial',
          0,
          0,
          1,
          0,
          10
        );

        insert into public.quiz_attempts (
          id,
          student_id,
          assignment_id,
          attempt_number,
          status,
          phase,
          started_at,
          deadline_at,
          question_count_snapshot,
          time_limit_seconds_snapshot,
          passing_score_snapshot,
          passing_basis_snapshot
        )
        values (
          '${initialAttemptId}',
          '${ids.student}',
          '${initialAssignment}',
          1,
          'in_progress',
          'initial',
          clock_timestamp(),
          clock_timestamp() + interval '1 hour',
          1,
          60,
          80,
          'initial'
        );

        insert into public.quiz_questions (
          attempt_id,
          vocab_entry_id,
          order_index,
          direction,
          prompt,
          choices,
          correct_choice_index
        )
        values (
          '${initialAttemptId}',
          1,
          1,
          'english_to_korean',
          'alpha',
          '["알파", "베타", "감마", "델타"]'::jsonb,
          0
        );

        set role authenticated;
        select public.delete_student_v1('${ids.student}');
        reset role;
      `);

      const state = await database.query<{
        deleted: boolean;
        blocked: boolean;
        code_count: number;
        active_session_count: number;
        unstarted_cancelled: boolean;
        started_cancelled: boolean;
        attempt_count: number;
        attempt_status: string;
        initial_attempt_status: string;
        peer_cancelled: boolean;
        shared_assignment_status: string;
      }>(`
        select
          student.deleted_at is not null as deleted,
          student.status = 'blocked' as blocked,
          (
            select count(*)::integer
            from public.student_codes as code
            where code.student_id = student.id
          ) as code_count,
          (
            select count(*)::integer
            from public.student_sessions as session
            where session.student_id = student.id
              and session.revoked_at is null
          ) as active_session_count,
          (
            select link.cancelled_at is not null
            from public.assignment_students as link
            where link.assignment_id = '${unstartedAssignment}'
              and link.student_id = student.id
          ) as unstarted_cancelled,
          (
            select link.cancelled_at is not null
            from public.assignment_students as link
            where link.assignment_id = '${startedAssignment}'
              and link.student_id = student.id
          ) as started_cancelled,
          (
            select count(*)::integer
            from public.quiz_attempts as attempt
            where attempt.student_id = student.id
              and attempt.id in (
                '${attemptId}',
                '${initialAttemptId}'
              )
          ) as attempt_count,
          (
            select attempt.status::text
            from public.quiz_attempts as attempt
            where attempt.id = '${attemptId}'
          ) as attempt_status,
          (
            select attempt.status::text
            from public.quiz_attempts as attempt
            where attempt.id = '${initialAttemptId}'
          ) as initial_attempt_status,
          (
            select link.cancelled_at is not null
            from public.assignment_students as link
            where link.assignment_id = '${unstartedAssignment}'
              and link.student_id = '${peerStudent}'
          ) as peer_cancelled,
          (
            select assignment.status::text
            from public.assignments as assignment
            where assignment.id = '${unstartedAssignment}'
          ) as shared_assignment_status
        from public.students as student
        where student.id = '${ids.student}';
      `);

      expect(state.rows[0]).toEqual({
        deleted: true,
        blocked: true,
        code_count: 0,
        active_session_count: 0,
        unstarted_cancelled: true,
        started_cancelled: false,
        attempt_count: 2,
        attempt_status: "expired",
        initial_attempt_status: "expired",
        peer_cancelled: false,
        shared_assignment_status: "active",
      });

      await expectPostgresError(
        database.exec(`
          update public.students
          set display_name = 'Reactivated'
          where id = '${ids.student}';
        `),
        "55000",
        "deleted_student_is_immutable",
      );
      await expectPostgresError(
        database.exec(`
          delete from public.students
          where id = '${ids.student}';
        `),
        "55000",
        "student_physical_delete_forbidden",
      );
      await expectPostgresError(
        database.exec(`
          insert into public.quiz_attempts (
            student_id,
            assignment_id,
            attempt_number,
            status,
            phase,
            started_at,
            deadline_at,
            question_count_snapshot,
            time_limit_seconds_snapshot,
            passing_score_snapshot,
            passing_basis_snapshot
          )
          values (
            '${ids.student}',
            '${startedAssignment}',
            2,
            'in_progress',
            'initial',
            clock_timestamp(),
            clock_timestamp() + interval '1 hour',
            1,
            60,
            80,
            'initial'
          );
        `),
        "22023",
        "student_deleted",
      );
    } finally {
      await database.close();
    }
  }, 30_000);

  it("학생 삭제 v2는 익명 사용자와 비활성 관리자를 거부한다", async () => {
    const database = await createFinalSchemaDatabase();
    try {
      await seedReviewAssignmentScenario(database);
      await database.exec("set role anon;");
      await expectPostgresError(
        database.query(`
          select public.delete_student_v2('${ids.student}');
        `),
        "42501",
        "permission denied",
      );
      await database.exec(`
        reset role;
        update public.admin_profiles
        set is_active = false
        where user_id = '${ids.admin}';
        set role authenticated;
      `);
      await expectPostgresError(
        database.query(`
          select public.delete_student_v2('${ids.student}');
        `),
        "42501",
        "forbidden",
      );
      await database.exec("reset role;");
    } finally {
      await database.close();
    }
  }, 30_000);

  it("deletes one student with target-only expiry, queue cleanup, and idempotent audit", async () => {
    const database = await createFinalSchemaDatabase();
    const peerStudent = "00000000-0000-4000-8000-000000000721";
    const requestId = "00000000-0000-4000-8000-000000000722";
    const targetSeries = "00000000-0000-4000-8000-000000000723";
    const peerSeries = "00000000-0000-4000-8000-000000000724";
    const targetItem = "00000000-0000-4000-8000-000000000725";
    const peerItem = "00000000-0000-4000-8000-000000000726";
    try {
      await seedReviewAssignmentScenario(database);
      await database.exec(`
        insert into public.students (id, display_name, status, created_by)
        values ('${peerStudent}', 'Deletion peer', 'active', '${ids.admin}');
      `);
      const target = await createRegularPointAttempt(
        database,
        "Targeted student deletion",
      );
      const peer = await createRegularPointAttempt(
        database,
        "Untouched peer deletion",
        { studentId: peerStudent },
      );

      await database.exec(`
        update public.quiz_attempts
        set
          started_at = clock_timestamp() - interval '2 minutes',
          current_question_started_at = clock_timestamp() - interval '2 minutes',
          deadline_at = clock_timestamp() - interval '1 minute'
        where id in ('${target.attemptId}', '${peer.attemptId}');

        insert into private.vocab_assignment_queue_requests (
          idempotency_key,
          request_sha256,
          payload_sha256,
          actor_admin_id
        ) values (
          '${requestId}',
          repeat('a', 64),
          repeat('b', 64),
          '${ids.admin}'
        );

        insert into private.vocab_assignment_series (
          id,
          request_id,
          student_id,
          dataset_id,
          actor_admin_id,
          dataset_label,
          range_label,
          recurrence_slots,
          status
        ) values
          (
            '${targetSeries}',
            '${requestId}',
            '${ids.student}',
            '${ids.dataset}',
            '${ids.admin}',
            'Target dataset',
            'Target range',
            '[{"isodow":1,"local_time":"10:00","duration_seconds":3600}]'::jsonb,
            'active'
          ),
          (
            '${peerSeries}',
            '${requestId}',
            '${peerStudent}',
            '${ids.dataset}',
            '${ids.admin}',
            'Peer dataset',
            'Peer range',
            '[{"isodow":1,"local_time":"10:00","duration_seconds":3600}]'::jsonb,
            'active'
          );

        insert into private.vocab_assignment_series_items (
          id,
          series_id,
          sequence_number,
          status,
          question_count,
          unit_ids,
          unit_labels,
          planned_available_from,
          planned_available_until,
          effective_available_from,
          effective_available_until,
          payload,
          assignment_id,
          materialized_at
        ) values
          (
            '${targetItem}',
            '${targetSeries}',
            1,
            'assigned',
            4,
            array['${ids.units[0]}'::uuid],
            array['DAY 1'],
            clock_timestamp(),
            clock_timestamp() + interval '1 hour',
            clock_timestamp(),
            clock_timestamp() + interval '1 hour',
            '{"retry_enabled":true,"retry_passing_score":100,"passing_score":100}'::jsonb,
            '${target.assignmentId}',
            clock_timestamp()
          ),
          (
            '${peerItem}',
            '${peerSeries}',
            1,
            'queued',
            4,
            array['${ids.units[0]}'::uuid],
            array['DAY 1'],
            clock_timestamp(),
            clock_timestamp() + interval '1 hour',
            clock_timestamp(),
            clock_timestamp() + interval '1 hour',
            '{}'::jsonb,
            null,
            null
          );

        insert into private.student_app_maintenance_retry_state (
          job_name,
          target_kind,
          target_id,
          student_id,
          consecutive_failures,
          next_retry_at,
          requires_attention,
          last_error_code,
          last_failed_at,
          updated_at
        ) values
          (
            'english-academy-finalize-stale-attempts',
            'quiz_attempt',
            '${target.attemptId}',
            '${ids.student}',
            1,
            clock_timestamp(),
            false,
            '40001',
            clock_timestamp(),
            clock_timestamp()
          ),
          (
            'english-academy-finalize-stale-attempts',
            'quiz_attempt',
            '${peer.attemptId}',
            '${peerStudent}',
            1,
            clock_timestamp(),
            false,
            '40001',
            clock_timestamp(),
            clock_timestamp()
          );
      `);

      await database.exec("set role authenticated;");
      const first = await database.query<{ result: Record<string, unknown> }>(`
        select public.delete_student_v2('${ids.student}') as result;
      `);
      const second = await database.query<{ result: Record<string, unknown> }>(`
        select public.delete_student_v2('${ids.student}') as result;
      `);
      await database.exec("reset role;");

      expect(first.rows[0]?.result).toMatchObject({
        status: "deleted",
        studentId: ids.student,
        expiredAttemptCount: 1,
        abandonedAttemptCount: 0,
        cancelledSeriesCount: 1,
        cancelledSeriesItemCount: 1,
      });
      expect(second.rows[0]?.result).toMatchObject({
        status: "deleted",
        studentId: ids.student,
        expiredAttemptCount: 0,
        abandonedAttemptCount: 0,
        cancelledSeriesCount: 0,
        cancelledSeriesItemCount: 0,
      });

      const state = await database.query<{
        target_deleted: boolean;
        peer_deleted: boolean;
        target_attempt_status: string;
        peer_attempt_status: string;
        target_timed_out: number;
        target_wrong_events: number;
        peer_wrong_events: number;
        target_point_events: number;
        target_points: number;
        peer_point_events: number;
        target_series_status: string;
        target_item_status: string;
        peer_series_status: string;
        peer_item_status: string;
        target_retries: number;
        peer_retries: number;
        cancelled_events: number;
        attention_events: number;
        deletion_audits: number;
      }>(`
        select
          (select deleted_at is not null from public.students where id = '${ids.student}') as target_deleted,
          (select deleted_at is not null from public.students where id = '${peerStudent}') as peer_deleted,
          (select status::text from public.quiz_attempts where id = '${target.attemptId}') as target_attempt_status,
          (select status::text from public.quiz_attempts where id = '${peer.attemptId}') as peer_attempt_status,
          (select count(*)::integer from public.quiz_questions where attempt_id = '${target.attemptId}' and initial_timed_out) as target_timed_out,
          (select count(*)::integer from public.student_vocab_wrong_events where quiz_attempt_id = '${target.attemptId}') as target_wrong_events,
          (select count(*)::integer from public.student_vocab_wrong_events where quiz_attempt_id = '${peer.attemptId}') as peer_wrong_events,
          (select count(*)::integer from public.student_point_events where quiz_attempt_id = '${target.attemptId}') as target_point_events,
          (select coalesce(sum(delta), 0)::integer from public.student_point_events where quiz_attempt_id = '${target.attemptId}') as target_points,
          (select count(*)::integer from public.student_point_events where quiz_attempt_id = '${peer.attemptId}') as peer_point_events,
          (select status from private.vocab_assignment_series where id = '${targetSeries}') as target_series_status,
          (select status from private.vocab_assignment_series_items where id = '${targetItem}') as target_item_status,
          (select status from private.vocab_assignment_series where id = '${peerSeries}') as peer_series_status,
          (select status from private.vocab_assignment_series_items where id = '${peerItem}') as peer_item_status,
          (select count(*)::integer from private.student_app_maintenance_retry_state where student_id = '${ids.student}') as target_retries,
          (select count(*)::integer from private.student_app_maintenance_retry_state where student_id = '${peerStudent}') as peer_retries,
          (select count(*)::integer from private.vocab_assignment_series_events where series_id = '${targetSeries}' and event_kind = 'series.cancelled') as cancelled_events,
          (select count(*)::integer from private.vocab_assignment_series_events where series_id = '${targetSeries}' and event_kind = 'session.attention') as attention_events,
          (select count(*)::integer from public.audit_events where event_type = 'student.deleted' and student_id = '${ids.student}') as deletion_audits;
      `);
      expect(state.rows[0]).toEqual({
        target_deleted: true,
        peer_deleted: false,
        target_attempt_status: "expired",
        peer_attempt_status: "in_progress",
        target_timed_out: 4,
        target_wrong_events: 4,
        peer_wrong_events: 0,
        target_point_events: 4,
        target_points: -6,
        peer_point_events: 0,
        target_series_status: "cancelled",
        target_item_status: "cancelled",
        peer_series_status: "active",
        peer_item_status: "queued",
        target_retries: 0,
        peer_retries: 1,
        cancelled_events: 1,
        attention_events: 0,
        deletion_audits: 1,
      });
    } finally {
      await database.close();
    }
  }, 60_000);

  it("deletes one assignment after finalizing only its expired attempts", async () => {
    const database = await createFinalSchemaDatabase();
    const peerStudent = "00000000-0000-4000-8000-000000000731";
    try {
      await seedReviewAssignmentScenario(database);
      await database.exec(`
        insert into public.students (id, display_name, status, created_by)
        values ('${peerStudent}', 'Assignment peer', 'active', '${ids.admin}');
      `);
      const target = await createRegularPointAttempt(
        database,
        "Targeted assignment deletion",
      );
      const peer = await createRegularPointAttempt(
        database,
        "Untouched assignment deletion",
        { studentId: peerStudent },
      );
      await database.exec(`
        update public.quiz_attempts
        set
          started_at = clock_timestamp() - interval '2 minutes',
          current_question_started_at = clock_timestamp() - interval '2 minutes',
          deadline_at = clock_timestamp() - interval '1 minute'
        where id in ('${target.attemptId}', '${peer.attemptId}');
      `);

      await database.exec("set role authenticated;");
      const first = await database.query<{ result: Record<string, unknown> }>(`
        select public.delete_assignment_v2(
          '${target.assignmentId}',
          'targeted integration test'
        ) as result;
      `);
      const second = await database.query<{ result: Record<string, unknown> }>(`
        select public.delete_assignment_v2(
          '${target.assignmentId}',
          'targeted integration test'
        ) as result;
      `);
      await database.exec("reset role;");

      expect(first.rows[0]?.result).toMatchObject({
        status: "deleted",
        assignmentId: target.assignmentId,
        expiredAttemptCount: 1,
      });
      expect(second.rows[0]?.result).toMatchObject({
        status: "deleted",
        assignmentId: target.assignmentId,
        expiredAttemptCount: 0,
      });

      const state = await database.query<{
        target_assignment_deleted: boolean;
        peer_assignment_deleted: boolean;
        target_attempt_status: string;
        peer_attempt_status: string;
        target_wrong_events: number;
        peer_wrong_events: number;
        target_point_events: number;
        peer_point_events: number;
        target_audits: number;
      }>(`
        select
          (select deleted_at is not null from public.assignments where id = '${target.assignmentId}') as target_assignment_deleted,
          (select deleted_at is not null from public.assignments where id = '${peer.assignmentId}') as peer_assignment_deleted,
          (select status::text from public.quiz_attempts where id = '${target.attemptId}') as target_attempt_status,
          (select status::text from public.quiz_attempts where id = '${peer.attemptId}') as peer_attempt_status,
          (select count(*)::integer from public.student_vocab_wrong_events where quiz_attempt_id = '${target.attemptId}') as target_wrong_events,
          (select count(*)::integer from public.student_vocab_wrong_events where quiz_attempt_id = '${peer.attemptId}') as peer_wrong_events,
          (select count(*)::integer from public.student_point_events where quiz_attempt_id = '${target.attemptId}') as target_point_events,
          (select count(*)::integer from public.student_point_events where quiz_attempt_id = '${peer.attemptId}') as peer_point_events,
          (select count(*)::integer from public.audit_events where event_type = 'assignment.deleted' and details ->> 'assignmentId' = '${target.assignmentId}') as target_audits;
      `);
      expect(state.rows[0]).toEqual({
        target_assignment_deleted: true,
        peer_assignment_deleted: false,
        target_attempt_status: "expired",
        peer_attempt_status: "in_progress",
        target_wrong_events: 4,
        peer_wrong_events: 0,
        target_point_events: 4,
        peer_point_events: 0,
        target_audits: 1,
      });
    } finally {
      await database.close();
    }
  }, 60_000);

  it("deletes an unstarted assignment, rejects an active attempt, and hides history idempotently", async () => {
    const database = await createFinalSchemaDatabase();
    try {
      await seedReviewAssignmentScenario(database);
      const deletableAssignment =
        "00000000-0000-4000-8000-000000000711";
      const activeAssignment =
        "00000000-0000-4000-8000-000000000712";
      const activeAttempt =
        "00000000-0000-4000-8000-000000000713";

      await database.exec(`
        insert into public.assignments (
          id,
          title,
          dataset_id,
          range_start,
          range_end,
          question_count,
          english_to_korean_ratio,
          time_limit_seconds,
          passing_score,
          status,
          available_from,
          created_by,
          range_basis,
          question_order_mode,
          question_bank_version
        )
        values
          (
            '${deletableAssignment}',
            'Deletable fixture',
            '${ids.dataset}',
            1,
            1,
            1,
            100,
            60,
            80,
            'active',
            clock_timestamp(),
            '${ids.admin}',
            'units',
            'fixed',
            1
          ),
          (
            '${activeAssignment}',
            'Active fixture',
            '${ids.dataset}',
            1,
            1,
            1,
            100,
            60,
            80,
            'active',
            clock_timestamp(),
            '${ids.admin}',
            'units',
            'fixed',
            1
          );

        insert into public.assignment_units (
          assignment_id,
          dataset_id,
          unit_id,
          position,
          is_primary
        )
        values
          (
            '${deletableAssignment}',
            '${ids.dataset}',
            '${ids.units[0]}',
            1,
            true
          ),
          (
            '${activeAssignment}',
            '${ids.dataset}',
            '${ids.units[0]}',
            1,
            true
          );

        insert into public.assignment_students (
          assignment_id,
          student_id,
          assigned_by
        )
        values
          (
            '${deletableAssignment}',
            '${ids.student}',
            '${ids.admin}'
          ),
          (
            '${activeAssignment}',
            '${ids.student}',
            '${ids.admin}'
          );

        insert into public.quiz_attempts (
          id,
          student_id,
          assignment_id,
          attempt_number,
          status,
          phase,
          started_at,
          deadline_at,
          question_count_snapshot,
          time_limit_seconds_snapshot,
          passing_score_snapshot,
          passing_basis_snapshot
        )
        values (
          '${activeAttempt}',
          '${ids.student}',
          '${activeAssignment}',
          1,
          'in_progress',
          'initial',
          clock_timestamp(),
          clock_timestamp() + interval '1 hour',
          1,
          60,
          80,
          'initial'
        );

        set role authenticated;
        select public.delete_assignment_v2(
          '${deletableAssignment}',
          'integration test'
        );
        select public.hide_admin_history_entry_v1(
          '${deletableAssignment}',
          '${ids.student}',
          null
        );
        select public.hide_admin_history_entry_v1(
          '${deletableAssignment}',
          '${ids.student}',
          null
        );
        reset role;
      `);

      const state = await database.query<{
        deleted: boolean;
        closed: boolean;
        cancelled: boolean;
        hidden_count: number;
        hidden_audit_count: number;
      }>(`
        select
          assignment.deleted_at is not null as deleted,
          assignment.status = 'closed' as closed,
          link.cancelled_at is not null as cancelled,
          (
            select count(*)::integer
            from public.admin_history_hidden_entries as hidden
            where hidden.assignment_id = assignment.id
              and hidden.student_id = link.student_id
              and hidden.attempt_id is null
          ) as hidden_count,
          (
            select count(*)::integer
            from public.audit_events as audit
            where audit.event_type = 'admin.history.hidden'
              and audit.details ->> 'assignmentId' = assignment.id::text
          ) as hidden_audit_count
        from public.assignments as assignment
        join public.assignment_students as link
          on link.assignment_id = assignment.id
        where assignment.id = '${deletableAssignment}';
      `);

      expect(state.rows[0]).toEqual({
        deleted: true,
        closed: true,
        cancelled: true,
        hidden_count: 1,
        hidden_audit_count: 1,
      });

      await expectPostgresError(
        database.exec(`
          delete from public.assignments
          where id = '${deletableAssignment}';
        `),
        "55000",
        "assignment_physical_delete_forbidden",
      );
      await expectPostgresError(
        database.exec(`
          insert into public.quiz_attempts (
            student_id,
            assignment_id,
            attempt_number,
            status,
            phase,
            started_at,
            deadline_at,
            question_count_snapshot,
            time_limit_seconds_snapshot,
            passing_score_snapshot,
            passing_basis_snapshot
          )
          values (
            '${ids.student}',
            '${deletableAssignment}',
            1,
            'in_progress',
            'initial',
            clock_timestamp(),
            clock_timestamp() + interval '1 hour',
            1,
            60,
            80,
            'initial'
          );
        `),
        "22023",
        "assignment_deleted",
      );

      await database.exec("set role authenticated;");
      await expectPostgresError(
        database.query(`
          select public.hide_admin_history_entry_v1(
            '${activeAssignment}',
            '${ids.student}',
            null
          );
        `),
        "55000",
        "history_entry_stale",
      );
      await expectPostgresError(
        database.query(`
          select public.delete_assignment_v2(
            '${activeAssignment}',
            'must fail'
          );
        `),
        "55000",
        "assignment_has_in_progress_attempt",
      );
      await database.exec("reset role;");
    } finally {
      await database.close();
    }
  }, 30_000);

  it("preserves mixed targets for metadata edits and rejects locked-shape changes", async () => {
    const mixedReplacementDatabase = await createFinalSchemaDatabase();
    const replacementKey = "00000000-0000-4000-8000-000000000811";
    const rollbackKey = "00000000-0000-4000-8000-000000000812";
    try {
      await seedReviewAssignmentScenario(mixedReplacementDatabase);
      await mixedReplacementDatabase.exec(`
        update public.student_vocab_review_queue
        set status = 'cancelled', cancelled_at = clock_timestamp()
        where id = '${ids.overlappingQueue}';
      `);
      const queueSource = await mixedReplacementDatabase.query<{
        assignment_id: string;
      }>(`
        select private.create_assignment_with_question_bank_v3(
          'Mixed queue source', '${ids.dataset}',
          array['${ids.units[4]}'::uuid], 4, 100::smallint, 600,
          80::smallint, 'fixed', null, array['${ids.student}'::uuid],
          $questions$${mixedQuestions}$questions$::jsonb
        ) as assignment_id;
      `);
      const queueSourceAssignmentId = queueSource.rows[0]!.assignment_id;
      const queueAttempt = await mixedReplacementDatabase.query<{
        attempt_id: string;
      }>(`
        select public.create_quiz_attempt_from_bank(
          '${ids.student}', '${queueSourceAssignmentId}'
        ) as attempt_id;
      `);
      const queueQuestion = await mixedReplacementDatabase.query<{
        id: string;
      }>(`
        select id from public.quiz_questions
        where attempt_id = '${queueAttempt.rows[0]!.attempt_id}'
          and vocab_entry_id = 1;
      `);
      await mixedReplacementDatabase.exec(`
        update public.student_vocab_review_queue
        set
          source_attempt_id = '${queueAttempt.rows[0]!.attempt_id}',
          source_question_id = '${queueQuestion.rows[0]!.id}'
        where id = '${ids.selectedQueue}';
        update public.assignments
        set status = 'closed'
        where id = '${queueSourceAssignmentId}';
        set role authenticated;
      `);
      const source = await mixedReplacementDatabase.query<{
        assignment_id: string;
      }>(`
        select public.create_mixed_review_assignment_v8(
          '${ids.student}', '${ids.dataset}', array[1]::smallint[],
          'dataset',
          array['${ids.selectedQueue}'::uuid], 'Mixed source',
          array['${ids.units[4]}'::uuid], 100::smallint, 600,
          80::smallint, 'fixed', null, 'total', null,
          $questions$${mixedQuestions}$questions$::jsonb
        ) as assignment_id;
      `);
      const sourceAssignmentId = source.rows[0]!.assignment_id;

      await mixedReplacementDatabase.exec("reset role;");
      const persistedSourcePlan = await mixedReplacementDatabase.query<{
        questions: unknown;
      }>(`
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'vocab_entry_id', question.vocab_entry_id,
              'base_order_index', question.base_order_index,
              'direction', question.direction,
              'choice_vocab_entry_ids', question.choice_vocab_entry_ids
            ) order by question.base_order_index
          ),
          '[]'::jsonb
        ) as questions
        from public.assignment_questions as question
        where question.assignment_id = '${sourceAssignmentId}';
      `);
      const sourceQuestions = JSON.stringify(
        persistedSourcePlan.rows[0]!.questions,
      );
      await mixedReplacementDatabase.exec("set role authenticated;");

      const replacement = await mixedReplacementDatabase.query<{
        result: {
          replacementAssignmentId: string;
          replacementPurpose: string;
        };
      }>(`
        select public.replace_student_assignment_v6(
          '${sourceAssignmentId}', '${ids.student}', '${replacementKey}',
          repeat('b', 64), 'mixed', 'preserve', 'Mixed renamed',
          '${ids.dataset}', array['${ids.units[4]}'::uuid], 4,
          100::smallint, 600, 80::smallint, true, 80::smallint,
          'fixed', null, null, 'total', null, array[1]::smallint[],
          'dataset',
          array['${ids.selectedQueue}'::uuid],
          $questions$${sourceQuestions}$questions$::jsonb
        ) as result;
      `);
      await mixedReplacementDatabase.exec("reset role;");
      const replacementAssignmentId =
        replacement.rows[0]!.result.replacementAssignmentId;
      expect(replacement.rows[0]!.result.replacementPurpose).toBe(
        "mixed",
      );

      const state = await mixedReplacementDatabase.query<{
        source_cancelled: boolean;
        source_released_targets: number;
        replacement_active_targets: number;
        queue_status: string;
        queue_consumed_assignment: string | null;
        before_queues: unknown;
        after_queues: unknown;
        before_hash: string;
        after_hash: string;
      }>(`
        select
          (
            select cancelled_at is not null
            from public.assignment_students
            where assignment_id = '${sourceAssignmentId}'
              and student_id = '${ids.student}'
          ) as source_cancelled,
          (
            select count(*)::integer
            from public.assignment_review_targets
            where assignment_id = '${sourceAssignmentId}'
              and released_at is not null
          ) as source_released_targets,
          (
            select count(*)::integer
            from public.assignment_review_targets
            where assignment_id = '${replacementAssignmentId}'
              and released_at is null
          ) as replacement_active_targets,
          queue.status as queue_status,
          queue.consumed_assignment_id::text as queue_consumed_assignment,
          audit.details -> 'before' -> 'reviewQueueIds' as before_queues,
          audit.details -> 'after' -> 'reviewQueueIds' as after_queues,
          audit.details -> 'before' ->> 'questionBankSha256' as before_hash,
          audit.details -> 'after' ->> 'questionBankSha256' as after_hash
        from public.student_vocab_review_queue as queue
        join public.audit_events as audit
          on audit.event_type = 'assignment.student.replaced'
         and audit.details ->> 'sourceAssignmentId' = '${sourceAssignmentId}'
        where queue.id = '${ids.selectedQueue}';
      `);
      expect(state.rows[0]).toMatchObject({
        source_cancelled: true,
        source_released_targets: 1,
        replacement_active_targets: 1,
        queue_status: "pending",
        queue_consumed_assignment: null,
        before_queues: [ids.selectedQueue],
        after_queues: [ids.selectedQueue],
      });
      expect(state.rows[0]!.before_hash).toBe(state.rows[0]!.after_hash);

      const invalidQuestions = JSON.stringify(
        JSON.parse(sourceQuestions).map(
          (question: Record<string, unknown>) => ({
            ...question,
            base_order_index: 1,
          }),
        ),
      );
      await mixedReplacementDatabase.exec("set role authenticated;");
      await expectPostgresError(
        mixedReplacementDatabase.query(`
          select public.replace_student_assignment_v6(
            '${replacementAssignmentId}', '${ids.student}', '${rollbackKey}',
            repeat('c', 64), 'mixed', 'preserve', 'Must roll back',
            '${ids.dataset}', array['${ids.units[4]}'::uuid], 4,
            100::smallint, 600, 80::smallint, true, 80::smallint,
            'fixed', null, null, 'total', null, array[1]::smallint[],
            'dataset',
            array['${ids.selectedQueue}'::uuid],
            $questions$${invalidQuestions}$questions$::jsonb
          );
        `),
        "22023",
        "assignment_edit_field_locked",
      );
      await mixedReplacementDatabase.exec("reset role;");

      const rollback = await mixedReplacementDatabase.query<{
        source_cancelled: boolean;
        active_targets: number;
        queue_status: string;
        ledger_count: number;
        audit_count: number;
      }>(`
        select
          link.cancelled_at is not null as source_cancelled,
          (
            select count(*)::integer
            from public.assignment_review_targets
            where assignment_id = '${replacementAssignmentId}'
              and released_at is null
          ) as active_targets,
          (
            select status from public.student_vocab_review_queue
            where id = '${ids.selectedQueue}'
          ) as queue_status,
          (
            select count(*)::integer
            from private.assignment_replacement_requests
            where idempotency_key = '${rollbackKey}'
          ) as ledger_count,
          (
            select count(*)::integer from public.audit_events
            where event_type = 'assignment.student.replaced'
              and details ->> 'sourceAssignmentId' = '${replacementAssignmentId}'
          ) as audit_count
        from public.assignment_students as link
        where link.assignment_id = '${replacementAssignmentId}'
          and link.student_id = '${ids.student}';
      `);
      expect(rollback.rows[0]).toEqual({
        source_cancelled: false,
        active_targets: 1,
        queue_status: "pending",
        ledger_count: 0,
        audit_count: 0,
      });

      const allReviewKey =
        "00000000-0000-4000-8000-000000000813";
      const oneReviewQuestion = JSON.stringify([
        {
          vocab_entry_id: 1,
          base_order_index: 1,
          direction: "english_to_korean",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
      ]);
      await mixedReplacementDatabase.exec("set role authenticated;");
      await expectPostgresError(
        mixedReplacementDatabase.query(`
          select public.replace_student_assignment_v6(
            '${replacementAssignmentId}', '${ids.student}', '${allReviewKey}',
            repeat('e', 64), 'review', 'preserve', 'Only wrong word',
            '${ids.dataset}', array['${ids.units[4]}'::uuid], 1,
            100::smallint, 600, 80::smallint, true, 80::smallint,
            'fixed', null, null, 'total', null, array[1]::smallint[],
            'dataset', array['${ids.selectedQueue}'::uuid],
            $questions$${oneReviewQuestion}$questions$::jsonb
          );
        `),
        "22023",
        "assignment_edit_field_locked",
      );
      await mixedReplacementDatabase.exec("reset role;");
    } finally {
      await mixedReplacementDatabase.close();
    }
  }, 40_000);

  it("replaces exact-review assignments with 1, 2, and 3 targets without losing their queue snapshot", async () => {
    const exactReplacementDatabase = await createFinalSchemaDatabase();
    const queueIds = [
      "00000000-0000-4000-8000-000000000321",
      "00000000-0000-4000-8000-000000000322",
      "00000000-0000-4000-8000-000000000323",
    ];
    try {
      await seedReviewAssignmentScenario(exactReplacementDatabase);
      await exactReplacementDatabase.exec(`
        update public.student_vocab_review_queue
        set status = 'cancelled', cancelled_at = clock_timestamp()
        where student_id = '${ids.student}';
      `);

      const queueSource = await exactReplacementDatabase.query<{
        assignment_id: string;
      }>(`
        select private.create_assignment_with_question_bank_v3(
          'Exact queue source',
          '${ids.dataset}',
          array[
            '${ids.units[0]}'::uuid,
            '${ids.units[1]}'::uuid,
            '${ids.units[2]}'::uuid,
            '${ids.units[3]}'::uuid,
            '${ids.units[4]}'::uuid
          ],
          4,
          100::smallint,
          600,
          80::smallint,
          'fixed',
          null,
          array['${ids.student}'::uuid],
          $questions$${mixedQuestions}$questions$::jsonb
        ) as assignment_id;
      `);
      const queueSourceAssignmentId =
        queueSource.rows[0]!.assignment_id;
      const queueSourceAttempt = await exactReplacementDatabase.query<{
        attempt_id: string;
      }>(`
        select public.create_quiz_attempt_from_bank(
          '${ids.student}',
          '${queueSourceAssignmentId}'
        ) as attempt_id;
      `);
      const queueSourceAttemptId = queueSourceAttempt.rows[0]!.attempt_id;
      const queueSourceQuestions = await exactReplacementDatabase.query<{
        id: string;
        vocab_entry_id: number;
      }>(`
        select id, vocab_entry_id
        from public.quiz_questions
        where attempt_id = '${queueSourceAttemptId}';
      `);
      const sourceQuestionByEntry = new Map(
        queueSourceQuestions.rows.map((question) => [
          question.vocab_entry_id,
          question.id,
        ]),
      );

      await exactReplacementDatabase.exec(`
        insert into public.student_vocab_review_queue (
          id, student_id, dataset_id, vocab_entry_id,
          canonical_lexeme_id_snapshot, source_attempt_id,
          source_question_id, reason_level, status, queued_by, queued_at
        )
        values
          (
            '${queueIds[0]}', '${ids.student}', '${ids.dataset}', 1,
            '${ids.lexemes[0]}',
            '${queueSourceAttemptId}',
            '${sourceQuestionByEntry.get(1)}',
            1, 'pending', '${ids.admin}', '2026-01-11T00:00:00Z'
          ),
          (
            '${queueIds[1]}', '${ids.student}', '${ids.dataset}', 2,
            '${ids.lexemes[1]}',
            '${queueSourceAttemptId}',
            '${sourceQuestionByEntry.get(2)}',
            1, 'pending', '${ids.admin}', '2026-01-12T00:00:00Z'
          ),
          (
            '${queueIds[2]}', '${ids.student}', '${ids.dataset}', 3,
            '${ids.lexemes[2]}',
            '${queueSourceAttemptId}',
            '${sourceQuestionByEntry.get(3)}',
            1, 'pending', '${ids.admin}', '2026-01-13T00:00:00Z'
          );

        update public.assignments
        set status = 'closed'
        where id = '${queueSourceAssignmentId}';
      `);

      for (const targetCount of [1, 2, 3]) {
        const replacementKey =
          `00000000-0000-4000-8000-00000000082${targetCount}`;
        const selectedQueueIds = queueIds.slice(0, targetCount);
        const questions = JSON.stringify(
          selectedQueueIds.map((_, index) => ({
            vocab_entry_id: index + 1,
            base_order_index: index + 1,
            direction: "english_to_korean",
            choice_vocab_entry_ids: [1, 2, 3, 4],
          })),
        );
        const queueSql = selectedQueueIds
          .map((queueId) => `'${queueId}'::uuid`)
          .join(",");

        const source = await exactReplacementDatabase.query<{
          assignment_id: string;
        }>(`
          select private.create_exact_review_assignment_v5(
            '${ids.student}', '${ids.dataset}', array[${queueSql}]::uuid[],
            'Exact source ${targetCount}', 100::smallint,
            600, 80::smallint, 'fixed', null, 'total', null,
            $questions$${questions}$questions$::jsonb
          ) as assignment_id;
        `);
        const sourceAssignmentId = source.rows[0]!.assignment_id;
        const storedQuestionPlan = await exactReplacementDatabase.query<{
          questions: unknown;
        }>(`
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'vocab_entry_id', question.vocab_entry_id,
                'base_order_index', question.base_order_index,
                'direction', question.direction,
                'choice_vocab_entry_ids', to_jsonb(question.choice_vocab_entry_ids)
              )
              order by question.base_order_index
            ),
            '[]'::jsonb
          ) as questions
          from public.assignment_questions as question
          where question.assignment_id = '${sourceAssignmentId}';
        `);
        const replacementQuestions = JSON.stringify(
          storedQuestionPlan.rows[0]!.questions,
        );
        expect(storedQuestionPlan.rows[0]!.questions).toEqual(
          JSON.parse(questions),
        );

        const changedChoiceKey =
          `00000000-0000-4000-8000-00000000083${targetCount}`;
        const changedChoiceQuestions = JSON.stringify(
          JSON.parse(questions).map((question: {
            choice_vocab_entry_ids: number[];
          }, index: number) => index === 0
            ? { ...question, choice_vocab_entry_ids: [2, 1, 3, 4] }
            : question),
        );
        await exactReplacementDatabase.exec("set role authenticated;");
        await expectPostgresError(
          exactReplacementDatabase.query(`
            select public.replace_student_assignment_v5(
              '${sourceAssignmentId}', '${ids.student}', '${changedChoiceKey}',
              repeat('c', 64), 'review', 'preserve',
              'Changed exact choices ${targetCount}', '${ids.dataset}',
              array[]::uuid[], ${targetCount}, 100::smallint, 600,
              80::smallint, true, 80::smallint, 'fixed', null, 'total', null,
              array[1]::smallint[], array[${queueSql}]::uuid[],
              $questions$${changedChoiceQuestions}$questions$::jsonb
            );
          `),
          "22023",
          "assignment_edit_field_locked",
        );
        await exactReplacementDatabase.exec("reset role;");
        const rejectedChoiceChange = await exactReplacementDatabase.query<{
          ledger_count: number;
          source_cancelled: boolean;
        }>(`
          select
            (
              select count(*)::integer
              from private.assignment_replacement_requests
              where idempotency_key = '${changedChoiceKey}'
            ) as ledger_count,
            (
              select cancelled_at is not null
              from public.assignment_students
              where assignment_id = '${sourceAssignmentId}'
                and student_id = '${ids.student}'
            ) as source_cancelled;
        `);
        expect(rejectedChoiceChange.rows[0]).toEqual({
          ledger_count: 0,
          source_cancelled: false,
        });

        await exactReplacementDatabase.exec("set role authenticated;");
        const replacement = await exactReplacementDatabase.query<{
          result: {
            replacementAssignmentId: string;
            replacementPurpose: string;
          };
        }>(`
          select public.replace_student_assignment_v5(
            '${sourceAssignmentId}', '${ids.student}', '${replacementKey}',
            repeat('d', 64), 'review', 'preserve',
            'Exact replacement ${targetCount}', '${ids.dataset}',
            array[]::uuid[], ${targetCount}, 100::smallint, 600,
            80::smallint, true, 80::smallint, 'fixed', null, 'total', null,
            array[1]::smallint[], array[${queueSql}]::uuid[],
            $questions$${replacementQuestions}$questions$::jsonb
          ) as result;
        `);
        await exactReplacementDatabase.exec("reset role;");
        const replacementAssignmentId =
          replacement.rows[0]!.result.replacementAssignmentId;
        expect(replacement.rows[0]!.result.replacementPurpose).toBe(
          "review",
        );

        const state = await exactReplacementDatabase.query<{
          source_cancelled: boolean;
          replacement_question_count: number;
          replacement_primary_units: number;
          source_active_targets: number;
          replacement_active_targets: number;
          pending_queues: number;
          before_queues: unknown;
          after_queues: unknown;
        }>(`
          select
            (
              select cancelled_at is not null
              from public.assignment_students
              where assignment_id = '${sourceAssignmentId}'
                and student_id = '${ids.student}'
            ) as source_cancelled,
            (
              select question_count from public.assignments
              where id = '${replacementAssignmentId}'
            ) as replacement_question_count,
            (
              select count(*)::integer from public.assignment_units
              where assignment_id = '${replacementAssignmentId}'
                and is_primary
            ) as replacement_primary_units,
            (
              select count(*)::integer from public.assignment_review_targets
              where assignment_id = '${sourceAssignmentId}'
                and released_at is null
            ) as source_active_targets,
            (
              select count(*)::integer from public.assignment_review_targets
              where assignment_id = '${replacementAssignmentId}'
                and released_at is null
            ) as replacement_active_targets,
            (
              select count(*)::integer
              from public.student_vocab_review_queue
              where id = any(array[${queueSql}]::uuid[])
                and status = 'pending'
                and consumed_assignment_id is null
            ) as pending_queues,
            audit.details -> 'before' -> 'reviewQueueIds' as before_queues,
            audit.details -> 'after' -> 'reviewQueueIds' as after_queues
          from public.audit_events as audit
          where audit.event_type = 'assignment.student.replaced'
            and audit.details ->> 'sourceAssignmentId' = '${sourceAssignmentId}';
        `);
        expect(state.rows[0]).toEqual({
          source_cancelled: true,
          replacement_question_count: targetCount,
          replacement_primary_units: 0,
          source_active_targets: 0,
          replacement_active_targets: targetCount,
          pending_queues: targetCount,
          before_queues: selectedQueueIds,
          after_queues: selectedQueueIds,
        });

        await exactReplacementDatabase.exec("set role authenticated;");
        await exactReplacementDatabase.query(`
          select public.cancel_student_assignment_v1(
            '${replacementAssignmentId}', '${ids.student}',
            'next exact replacement fixture'
          );
        `);
        await exactReplacementDatabase.exec("reset role;");
      }
    } finally {
      await exactReplacementDatabase.close();
    }
  }, 45_000);

  it("replaces only one shared recipient, retries idempotently, and rolls back a failed replacement", async () => {
    const replacementDatabase = await createFinalSchemaDatabase();
    const secondStudent = "00000000-0000-4000-8000-000000000702";
    const rollbackStudent = "00000000-0000-4000-8000-000000000703";
    const replacementKey = "00000000-0000-4000-8000-000000000801";
    const rollbackKey = "00000000-0000-4000-8000-000000000802";
    try {
      await seedReviewAssignmentScenario(replacementDatabase);
      await replacementDatabase.exec(`
        insert into public.students (
          id,
          display_name,
          status,
          created_by
        )
        values
          (
            '${secondStudent}',
            'Shared recipient',
            'active',
            '${ids.admin}'
          ),
          (
            '${rollbackStudent}',
            'Rollback recipient',
            'active',
            '${ids.admin}'
          );
      `);

      await replacementDatabase.exec("set role authenticated;");
      const source = await replacementDatabase.query<{ id: string }>(`
        select public.create_assignment_with_delivery_v6(
          'Shared source',
          '${ids.dataset}',
          array[
            '${ids.units[0]}'::uuid,
            '${ids.units[1]}'::uuid,
            '${ids.units[2]}'::uuid,
            '${ids.units[3]}'::uuid,
            '${ids.units[4]}'::uuid
          ],
          4,
          100::smallint,
          300,
          80::smallint,
          'ascending',
          null,
          array['${ids.student}'::uuid, '${secondStudent}'::uuid],
          'total',
          null,
          '${mixedQuestions}'::jsonb
        ) as id;
      `);
      const sourceAssignmentId = source.rows[0]!.id;

      await replacementDatabase.exec(`
        create temporary table replacement_deadline_fixture (
          deadline timestamptz not null
        );
        insert into replacement_deadline_fixture (deadline)
        values (clock_timestamp() + interval '3 seconds');
      `);

      const replaced = await replacementDatabase.query<{
        result: {
          replacementAssignmentId: string;
          idempotent: boolean;
        };
      }>(`
        select public.replace_student_assignment_v5(
          '${sourceAssignmentId}',
          '${ids.student}',
          '${replacementKey}',
          repeat('a', 64),
          'regular',
          'none',
          'Shared replacement',
          '${ids.dataset}',
          array[
            '${ids.units[0]}'::uuid,
            '${ids.units[1]}'::uuid,
            '${ids.units[2]}'::uuid,
            '${ids.units[3]}'::uuid,
            '${ids.units[4]}'::uuid
          ],
          4,
          100::smallint,
          300,
          80::smallint,
          true,
          80::smallint,
          'descending',
          (select deadline from replacement_deadline_fixture),
          'total',
          null,
          array[]::smallint[],
          array[]::uuid[],
          '${mixedQuestions}'::jsonb
        ) as result;
      `);
      const replacementAssignmentId =
        replaced.rows[0]!.result.replacementAssignmentId;
      expect(replaced.rows[0]!.result.idempotent).toBe(false);
      await replacementDatabase.exec("reset role;");

      const sharedState = await replacementDatabase.query<{
        source_question_count: number;
        source_selected_cancelled: boolean;
        source_other_cancelled: boolean;
        replacement_recipient_count: number;
        replacement_question_count: number;
        source_questions: unknown;
        replacement_questions: unknown;
        ledger_count: number;
        replacement_audit_count: number;
      }>(`
        select
          (
            select count(*)::integer
            from public.assignment_questions
            where assignment_id = '${sourceAssignmentId}'
          ) as source_question_count,
          (
            select cancelled_at is not null
            from public.assignment_students
            where assignment_id = '${sourceAssignmentId}'
              and student_id = '${ids.student}'
          ) as source_selected_cancelled,
          (
            select cancelled_at is not null
            from public.assignment_students
            where assignment_id = '${sourceAssignmentId}'
              and student_id = '${secondStudent}'
          ) as source_other_cancelled,
          (
            select count(*)::integer
            from public.assignment_students
            where assignment_id = '${replacementAssignmentId}'
              and student_id = '${ids.student}'
              and cancelled_at is null
          ) as replacement_recipient_count,
          (
            select count(*)::integer
            from public.assignment_questions
            where assignment_id = '${replacementAssignmentId}'
          ) as replacement_question_count,
          (
            select jsonb_agg(
              jsonb_build_object(
                'vocab_entry_id', question.vocab_entry_id,
                'base_order_index', question.base_order_index,
                'direction', question.direction,
                'choice_vocab_entry_ids', question.choice_vocab_entry_ids
              )
              order by question.base_order_index
            )
            from public.assignment_questions as question
            where question.assignment_id = '${sourceAssignmentId}'
          ) as source_questions,
          (
            select jsonb_agg(
              jsonb_build_object(
                'vocab_entry_id', question.vocab_entry_id,
                'base_order_index', question.base_order_index,
                'direction', question.direction,
                'choice_vocab_entry_ids', question.choice_vocab_entry_ids
              )
              order by question.base_order_index
            )
            from public.assignment_questions as question
            where question.assignment_id = '${replacementAssignmentId}'
          ) as replacement_questions,
          (
            select count(*)::integer
            from private.assignment_replacement_requests
            where idempotency_key = '${replacementKey}'
          ) as ledger_count,
          (
            select count(*)::integer
            from public.audit_events
            where event_type = 'assignment.student.replaced'
              and details ->> 'sourceAssignmentId' = '${sourceAssignmentId}'
          ) as replacement_audit_count;
      `);
      expect(sharedState.rows[0]!.source_questions).toEqual(
        sharedState.rows[0]!.replacement_questions,
      );
      expect(sharedState.rows[0]).toMatchObject({
        source_question_count: 4,
        source_selected_cancelled: true,
        source_other_cancelled: false,
        replacement_recipient_count: 1,
        replacement_question_count: 4,
        ledger_count: 1,
        replacement_audit_count: 1,
      });

      const otherRecipientAttempt = await replacementDatabase.query<{
        attempt_id: string;
      }>(`
        select public.create_quiz_attempt_from_bank(
          '${secondStudent}',
          '${sourceAssignmentId}'
        ) as attempt_id;
      `);
      expect(otherRecipientAttempt.rows[0]?.attempt_id).toMatch(
        /^[0-9a-f-]{36}$/i,
      );

      await replacementDatabase.exec(`
        update public.students
        set status = 'blocked'
        where id = '${ids.student}';
        select pg_sleep(3.1);
      `);
      await replacementDatabase.exec("set role authenticated;");
      const retried = await replacementDatabase.query<{
        result: {
          replacementAssignmentId: string;
          idempotent: boolean;
        };
      }>(`
        select public.replace_student_assignment_v5(
          '${sourceAssignmentId}',
          '${ids.student}',
          '${replacementKey}',
          repeat('a', 64),
          'regular',
          'none',
          'Shared replacement',
          '${ids.dataset}',
          array[
            '${ids.units[0]}'::uuid,
            '${ids.units[1]}'::uuid,
            '${ids.units[2]}'::uuid,
            '${ids.units[3]}'::uuid,
            '${ids.units[4]}'::uuid
          ],
          4,
          100::smallint,
          300,
          80::smallint,
          true,
          80::smallint,
          'descending',
          (select deadline from replacement_deadline_fixture),
          'total',
          null,
          array[]::smallint[],
          array[]::uuid[],
          '${mixedQuestions}'::jsonb
        ) as result;
      `);
      expect(retried.rows[0]!.result).toMatchObject({
        replacementAssignmentId,
        idempotent: true,
      });
      await replacementDatabase.exec(`
        reset role;
        update public.students
        set status = 'active'
        where id = '${ids.student}';
        set role authenticated;
      `);
      await expectPostgresError(
        replacementDatabase.query(`
          select public.replace_student_assignment_v5(
            '${sourceAssignmentId}',
            '${ids.student}',
            '${replacementKey}',
            repeat('a', 64),
            'regular',
            'none',
            'Shared replacement',
            '${ids.dataset}',
            array['${ids.units[0]}'::uuid],
            4,
            100::smallint,
            300,
            80::smallint,
            true,
            80::smallint,
            'descending',
            (select deadline from replacement_deadline_fixture),
            'total',
            null,
            array[]::smallint[],
            array[]::uuid[],
            '${mixedQuestions}'::jsonb
          );
        `),
        "23505",
        "idempotency_key_reused",
      );
      await expectPostgresError(
        replacementDatabase.query(`
          select public.get_student_assignment_replacement_result_v1(
            '${sourceAssignmentId}',
            '${ids.student}',
            '${replacementKey}',
            repeat('b', 64)
          );
        `),
        "23505",
        "idempotency_key_reused",
      );

      const rollbackSource = await replacementDatabase.query<{
        id: string;
      }>(`
        select public.create_assignment_with_delivery_v6(
          'Rollback source',
          '${ids.dataset}',
          array[
            '${ids.units[0]}'::uuid,
            '${ids.units[1]}'::uuid,
            '${ids.units[2]}'::uuid,
            '${ids.units[3]}'::uuid,
            '${ids.units[4]}'::uuid
          ],
          4,
          100::smallint,
          300,
          80::smallint,
          'ascending',
          null,
          array['${rollbackStudent}'::uuid],
          'total',
          null,
          '${mixedQuestions}'::jsonb
        ) as id;
      `);
      const rollbackSourceId = rollbackSource.rows[0]!.id;
      const invalidQuestions = JSON.stringify([
        ...JSON.parse(mixedQuestions).slice(0, 1),
        ...JSON.parse(mixedQuestions)
          .slice(1)
          .map((question: Record<string, unknown>) => ({
            ...question,
            base_order_index: 1,
          })),
      ]);

      await expectPostgresError(
        replacementDatabase.query(`
          select public.replace_student_assignment_v5(
            '${rollbackSourceId}',
            '${rollbackStudent}',
            '${rollbackKey}',
            repeat('c', 64),
            'regular',
            'none',
            'Must roll back',
            '${ids.dataset}',
            array[
              '${ids.units[0]}'::uuid,
              '${ids.units[1]}'::uuid,
              '${ids.units[2]}'::uuid,
              '${ids.units[3]}'::uuid,
              '${ids.units[4]}'::uuid
            ],
            4,
            100::smallint,
            300,
            80::smallint,
            true,
            80::smallint,
            'ascending',
            null,
            'total',
            null,
            array[]::smallint[],
            array[]::uuid[],
            '${invalidQuestions}'::jsonb
          );
        `),
        "23505",
        "assignment_questions_assignment_id_base_order_index_key",
      );

      await replacementDatabase.exec("reset role;");
      const rollbackState = await replacementDatabase.query<{
        cancelled: boolean;
        ledger_count: number;
        audit_count: number;
      }>(`
        select
          link.cancelled_at is not null as cancelled,
          (
            select count(*)::integer
            from private.assignment_replacement_requests
            where idempotency_key = '${rollbackKey}'
          ) as ledger_count,
          (
            select count(*)::integer
            from public.audit_events
            where event_type = 'assignment.student.replaced'
              and details ->> 'sourceAssignmentId' = '${rollbackSourceId}'
          ) as audit_count
        from public.assignment_students as link
        where link.assignment_id = '${rollbackSourceId}'
          and link.student_id = '${rollbackStudent}';
      `);
      expect(rollbackState.rows[0]).toEqual({
        cancelled: false,
        ledger_count: 0,
        audit_count: 0,
      });
      await replacementDatabase.exec("reset role;");
    } finally {
      await replacementDatabase.close();
    }
  }, 40_000);
});

describe.sequential("assignment retry rules", () => {
  it("backfills retry rules when deleted assignments already exist", async () => {
    let deletedAssignmentId: string | null = null;
    let deletedAssignmentUpdatedAt: string | null = null;
    const database = await createFinalSchemaDatabase({
      beforeMigration: async (pendingDatabase, migrationName) => {
        if (
          migrationName !== "20260824010000_add_assignment_retry_rules.sql"
        ) {
          return;
        }

        await seedReviewAssignmentScenario(pendingDatabase);
        const created = await pendingDatabase.query<{ assignment_id: string }>(`
          select private.create_assignment_with_question_bank_v3(
            'Deleted assignment retry backfill fixture',
            '${ids.dataset}',
            array['${ids.units[0]}'::uuid],
            1,
            100::smallint,
            300,
            80::smallint,
            'fixed',
            null,
            array['${ids.student}'::uuid],
            $questions$[
              {
                "vocab_entry_id": 1,
                "base_order_index": 1,
                "direction": "english_to_korean",
                "choice_vocab_entry_ids": [1, 2, 3, 4],
                "correct_choice_index": 0
              }
            ]$questions$::jsonb
          ) as assignment_id;
        `);
        deletedAssignmentId = created.rows[0]!.assignment_id;
        await pendingDatabase.exec("set role authenticated;");
        await pendingDatabase.query(`
          select public.delete_assignment_v1(
            '${deletedAssignmentId}',
            'retry migration fixture'
          );
        `);
        await pendingDatabase.exec("reset role;");
        const deletedState = await pendingDatabase.query<{
          updated_at: string;
        }>(`
          select updated_at::text
          from public.assignments
          where id = '${deletedAssignmentId}';
        `);
        deletedAssignmentUpdatedAt = deletedState.rows[0]!.updated_at;
      },
    });

    try {
      expect(deletedAssignmentId).not.toBeNull();
      const state = await database.query<{
        deleted_at: string;
        passing_score: number;
        retry_enabled: boolean;
        retry_passing_score: number;
        immutability_trigger_enabled: boolean;
        updated_at_trigger_enabled: boolean;
        updated_at: string;
      }>(`
        select
          assignment.deleted_at::text,
          assignment.updated_at::text,
          assignment.passing_score,
          assignment.retry_enabled,
          assignment.retry_passing_score,
          exists (
            select 1
            from pg_trigger as trigger
            where trigger.tgrelid = 'public.assignments'::regclass
              and trigger.tgname =
                'assignments_prevent_deleted_reactivation'
              and trigger.tgenabled = 'O'
          ) as immutability_trigger_enabled,
          exists (
            select 1
            from pg_trigger as trigger
            where trigger.tgrelid = 'public.assignments'::regclass
              and trigger.tgname = 'assignments_set_updated_at'
              and trigger.tgenabled = 'O'
          ) as updated_at_trigger_enabled
        from public.assignments as assignment
        where assignment.id = '${deletedAssignmentId}';
      `);
      expect(state.rows[0]).toMatchObject({
        passing_score: 80,
        retry_enabled: true,
        retry_passing_score: 80,
        immutability_trigger_enabled: true,
        updated_at_trigger_enabled: true,
      });
      expect(state.rows[0]?.deleted_at).toBeTruthy();
      expect(state.rows[0]?.updated_at).toBe(deletedAssignmentUpdatedAt);

      await expectPostgresError(
        database.query(`
          update public.assignments
          set title = 'Deleted assignment must stay immutable'
          where id = '${deletedAssignmentId}';
        `),
        "55000",
        "deleted_assignment_is_immutable",
      );
    } finally {
      await database.close();
    }
  }, 60_000);

  it("keeps retry rules separate from full-assignment retakes", async () => {
    const database = await createFinalSchemaDatabase();
    try {
    const schema = await database.query<{
      assignment_retry_enabled: string | null;
      assignment_retry_score: string | null;
      attempt_retry_enabled: string | null;
      attempt_retry_score: string | null;
      regular_v7: string | null;
      bulk_v9: string | null;
      queue_v2: string | null;
      exact_v7: string | null;
      replace_v5: string | null;
      answer_v4: string | null;
      start_retry_v2: string | null;
    }>(`
      select
        to_regclass('public.assignments')::text as assignment_table,
        (
          select column_name
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'assignments'
            and column_name = 'retry_enabled'
        ) as assignment_retry_enabled,
        (
          select column_name
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'assignments'
            and column_name = 'retry_passing_score'
        ) as assignment_retry_score,
        (
          select column_name
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'quiz_attempts'
            and column_name = 'retry_enabled_snapshot'
        ) as attempt_retry_enabled,
        (
          select column_name
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'quiz_attempts'
            and column_name = 'retry_passing_score_snapshot'
        ) as attempt_retry_score,
        to_regprocedure(
          'public.create_assignment_with_delivery_v7(text,uuid,uuid[],integer,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamp with time zone,uuid[],text,integer,jsonb)'
        )::text as regular_v7,
        to_regprocedure(
          'public.create_bulk_vocab_assignments_v9(uuid,text,jsonb)'
        )::text as bulk_v9,
        to_regprocedure(
          'public.create_vocab_assignment_queues_v2(uuid,text,jsonb)'
        )::text as queue_v2,
        to_regprocedure(
          'public.create_exact_review_assignment_v7(uuid,uuid,uuid[],text,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)'
        )::text as exact_v7,
        to_regprocedure(
          'public.replace_student_assignment_v5(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)'
        )::text as replace_v5,
        to_regprocedure(
          'public.answer_quiz_question_v4(uuid,uuid,uuid,text,smallint,boolean)'
        )::text as answer_v4,
        to_regprocedure(
          'public.start_quiz_retry_v2(uuid,uuid)'
        )::text as start_retry_v2;
    `);

    expect(schema.rows[0]).toMatchObject({
      assignment_retry_enabled: "retry_enabled",
      assignment_retry_score: "retry_passing_score",
      attempt_retry_enabled: "retry_enabled_snapshot",
      attempt_retry_score: "retry_passing_score_snapshot",
    });
    for (const functionName of [
      "regular_v7",
      "bulk_v9",
      "queue_v2",
      "exact_v7",
      "replace_v5",
      "answer_v4",
      "start_retry_v2",
    ] as const) {
      expect(schema.rows[0]?.[functionName]).not.toBeNull();
    }

    const answerDefinition = await database.query<{ definition: string }>(`
      select pg_get_functiondef(
        'public.answer_quiz_question_v4(uuid,uuid,uuid,text,smallint,boolean)'::regprocedure
      ) as definition;
    `);
    expect(answerDefinition.rows[0]?.definition).toContain(
      "not attempt_row.retry_enabled_snapshot",
    );
    expect(answerDefinition.rows[0]?.definition).toContain(
      "final_score >= retry_passing_score_snapshot",
    );

    const retakeColumn = await database.query<{ present: boolean }>(`
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'assignments'
          and column_name = 'retake_allowed'
      ) as present;
    `);
    expect(retakeColumn.rows[0]?.present).toBe(true);
    } finally {
      await database.close();
    }
  }, 60_000);

  it("applies all four timer and assignment deadline combinations to initial and retry deadlines", async () => {
    const database = await createFinalSchemaDatabase();
    const cases = [
      {
        key: "timed-with-deadline",
        studentId: "00000000-0000-4000-8000-000000007001",
        timingMode: "total" as const,
        usesAssignmentDeadline: true,
      },
      {
        key: "timed-without-deadline",
        studentId: "00000000-0000-4000-8000-000000007002",
        timingMode: "total" as const,
        usesAssignmentDeadline: false,
      },
      {
        key: "untimed-with-deadline",
        studentId: "00000000-0000-4000-8000-000000007003",
        timingMode: "none" as const,
        usesAssignmentDeadline: true,
      },
      {
        key: "untimed-without-deadline",
        studentId: "00000000-0000-4000-8000-000000007004",
        timingMode: "none" as const,
        usesAssignmentDeadline: false,
      },
    ];

    try {
      await seedReviewAssignmentScenario(database);
      await database.exec(`
        insert into public.students (id, display_name, status, created_by)
        values
          ('${cases[0].studentId}', 'Timer case 1', 'active', '${ids.admin}'),
          ('${cases[1].studentId}', 'Timer case 2', 'active', '${ids.admin}'),
          ('${cases[2].studentId}', 'Timer case 3', 'active', '${ids.admin}'),
          ('${cases[3].studentId}', 'Timer case 4', 'active', '${ids.admin}');
      `);

      for (const testCase of cases) {
        const availableUntil = testCase.usesAssignmentDeadline
          ? new Date(Date.now() + 5 * 60 * 1000)
          : null;
        const { assignmentId, attemptId, questions } =
          await createRegularPointAttempt(
            database,
            `Timer matrix ${testCase.key}`,
            {
              availableUntil,
              studentId: testCase.studentId,
              timeLimitSeconds: 600,
              timingMode: testCase.timingMode,
            },
          );

        const initialDeadline = await database.query<{
          deadline_after_assignment: boolean | null;
          is_infinite: boolean;
          matches_assignment_deadline: boolean;
          matches_timer: boolean | null;
        }>(`
          select
            case
              when assignment.timing_mode = 'total'
              then abs(extract(epoch from (
                attempt.deadline_at - attempt.started_at
              )) - 600) < 1
              else null
            end as matches_timer,
            attempt.deadline_at is not distinct from assignment.available_until
              as matches_assignment_deadline,
            attempt.deadline_at = 'infinity'::timestamptz as is_infinite,
            attempt.deadline_at > assignment.available_until
              as deadline_after_assignment
          from public.quiz_attempts as attempt
          join public.assignments as assignment
            on assignment.id = attempt.assignment_id
          where attempt.id = '${attemptId}'
            and assignment.id = '${assignmentId}';
        `);

        const expectUntimedDeadlinePreserved = async (stage: string) => {
          if (testCase.timingMode !== "none") return;
          const state = await database.query<{
            is_infinite: boolean;
            matches_assignment_deadline: boolean;
          }>(`
            select
              attempt.deadline_at = 'infinity'::timestamptz as is_infinite,
              attempt.deadline_at is not distinct from assignment.available_until
                as matches_assignment_deadline
            from public.quiz_attempts as attempt
            join public.assignments as assignment
              on assignment.id = attempt.assignment_id
            where attempt.id = '${attemptId}';
          `);
          expect(state.rows[0], `${testCase.key}:${stage}`).toEqual(
            testCase.usesAssignmentDeadline
              ? {
                  is_infinite: false,
                  matches_assignment_deadline: true,
                }
              : {
                  is_infinite: true,
                  matches_assignment_deadline: false,
                },
          );
        };

        for (const [index, question] of questions.entries()) {
          const choice = index === 0
            ? (question.correct_choice_index + 1) % 4
            : question.correct_choice_index;
          await database.query(`
            select public.answer_quiz_question_v4(
              '${testCase.studentId}',
              '${attemptId}',
              '${question.id}',
              'initial',
              ${choice}::smallint,
              false
            );
          `);
          const nextQuestion = questions[index + 1];
          if (nextQuestion) {
            await expectUntimedDeadlinePreserved(`answer-${index + 1}`);
            await database.query(`
              select public.resume_quiz_after_feedback_v2(
                '${testCase.studentId}',
                '${attemptId}',
                '${nextQuestion.id}',
                'initial',
                0
              );
            `);
            await expectUntimedDeadlinePreserved(`resume-${index + 1}`);
          }
        }

        await database.query(`
          select public.start_quiz_retry_v2(
            '${testCase.studentId}',
            '${attemptId}'
          );
        `);
        const retryDeadline = await database.query<{
          deadline_after_assignment: boolean | null;
          is_infinite: boolean;
          matches_assignment_deadline: boolean;
          matches_timer: boolean | null;
        }>(`
          select
            case
              when assignment.timing_mode = 'total'
              then abs(extract(epoch from (
                attempt.deadline_at - attempt.retry_started_at
              )) - 600) < 1
              else null
            end as matches_timer,
            attempt.deadline_at is not distinct from assignment.available_until
              as matches_assignment_deadline,
            attempt.deadline_at = 'infinity'::timestamptz as is_infinite,
            attempt.deadline_at > assignment.available_until
              as deadline_after_assignment
          from public.quiz_attempts as attempt
          join public.assignments as assignment
            on assignment.id = attempt.assignment_id
          where attempt.id = '${attemptId}';
        `);

        const expected = testCase.timingMode === "total"
          ? {
              matches_timer: true,
              matches_assignment_deadline: false,
              is_infinite: false,
              deadline_after_assignment:
                testCase.usesAssignmentDeadline ? true : null,
            }
          : testCase.usesAssignmentDeadline
            ? {
                matches_timer: null,
                matches_assignment_deadline: true,
                is_infinite: false,
                deadline_after_assignment: false,
              }
            : {
                matches_timer: null,
                matches_assignment_deadline: false,
                is_infinite: true,
                deadline_after_assignment: null,
              };
        expect(initialDeadline.rows[0], testCase.key).toEqual(expected);
        expect(retryDeadline.rows[0], testCase.key).toEqual(expected);
      }
    } finally {
      await database.close();
    }
  }, 90_000);

  it("persists disabled retry rules and completes the initial attempt without a retry", async () => {
    const database = await createFinalSchemaDatabase();
    try {
      await seedReviewAssignmentScenario(database);
      await database.exec("delete from public.student_vocab_review_queue;");
      await database.exec("set role authenticated;");
      const created = await database.query<{ assignment_id: string }>(`
        select public.create_assignment_with_delivery_v7(
          'Retry disabled fixture',
          '${ids.dataset}',
          array['${ids.units[0]}'::uuid, '${ids.units[4]}'::uuid],
          4,
          100::smallint,
          300,
          80::smallint,
          false,
          null,
          'fixed',
          null,
          array['${ids.student}'::uuid],
          'total',
          null,
          $questions$${mixedQuestions}$questions$::jsonb
        ) as assignment_id;
      `);
      await database.exec("reset role;");
      const assignmentId = created.rows[0]!.assignment_id;
      const attempt = await database.query<{ attempt_id: string }>(`
        select public.create_quiz_attempt_from_bank(
          '${ids.student}',
          '${assignmentId}'
        ) as attempt_id;
      `);
      const attemptId = attempt.rows[0]!.attempt_id;
      const retrySettings = await database.query<{
        assignment_enabled: boolean;
        assignment_score: number | null;
        attempt_enabled: boolean;
        attempt_score: number | null;
      }>(`
        select
          assignment.retry_enabled as assignment_enabled,
          assignment.retry_passing_score as assignment_score,
          attempt.retry_enabled_snapshot as attempt_enabled,
          attempt.retry_passing_score_snapshot as attempt_score
        from public.assignments as assignment
        join public.quiz_attempts as attempt
          on attempt.assignment_id = assignment.id
        where assignment.id = '${assignmentId}'
          and attempt.id = '${attemptId}';
      `);
      expect(retrySettings.rows[0]).toEqual({
        assignment_enabled: false,
        assignment_score: null,
        attempt_enabled: false,
        attempt_score: null,
      });

      const questions = await database.query<{
        id: string;
        correct_choice_index: number;
      }>(`
        select id, correct_choice_index
        from public.quiz_questions
        where attempt_id = '${attemptId}'
        order by order_index;
      `);
      let finalAnswer: { completed?: boolean; needsRetry?: boolean; passed?: boolean } = {};
      for (const [index, question] of questions.rows.entries()) {
        const choice = index === 0
          ? (question.correct_choice_index + 1) % 4
          : question.correct_choice_index;
        const answer = await database.query<{ result: typeof finalAnswer }>(`
          select public.answer_quiz_question_v4(
            '${ids.student}',
            '${attemptId}',
            '${question.id}',
            'initial',
            ${choice}::smallint,
            false
          ) as result;
        `);
        finalAnswer = answer.rows[0]!.result;
        const nextQuestion = questions.rows[index + 1];
        if (nextQuestion) {
          await database.query(`
            select public.resume_quiz_after_feedback_v2(
              '${ids.student}',
              '${attemptId}',
              '${nextQuestion.id}',
              'initial',
              0
            );
          `);
        }
      }
      expect(finalAnswer).toMatchObject({
        completed: true,
        needsRetry: false,
        passed: false,
      });
      const completed = await database.query<{
        passed: boolean;
        phase: string;
        status: string;
      }>(`
        select passed, phase::text, status::text
        from public.quiz_attempts
        where id = '${attemptId}';
      `);
      expect(completed.rows[0]).toEqual({
        passed: false,
        phase: "completed",
        status: "completed",
      });
      const points = await database.query<{
        event_count: number;
        ledger_sum: number;
        total_points: number;
        unique_outcomes: number;
      }>(`
        select
          total.total_points::integer,
          total.event_count::integer,
          count(distinct (event.quiz_question_id, event.stage))::integer
            as unique_outcomes,
          sum(event.delta)::integer as ledger_sum
        from public.student_point_totals as total
        join public.student_point_events as event
          on event.student_id = total.student_id
        where total.student_id = '${ids.student}'
          and event.quiz_attempt_id = '${attemptId}'
        group by total.total_points, total.event_count;
      `);
      expect(points.rows).toEqual([{
        total_points: 3,
        event_count: 4,
        unique_outcomes: 4,
        ledger_sum: 3,
      }]);
      await expectPostgresError(
        database.query(`
          select public.start_quiz_retry_v2(
            '${ids.student}',
            '${attemptId}'
          );
        `),
        "22023",
        "retry_disabled",
      );
    } finally {
      await database.close();
    }
  }, 60_000);

  it("records final-question initial and retry timeouts after answer v4 finishes", async () => {
    const database = await createFinalSchemaDatabase();
    try {
      await seedReviewAssignmentScenario(database);
      await database.exec("delete from public.student_vocab_review_queue;");
      await database.exec("set role authenticated;");
      const created = await database.query<{ assignment_id: string }>(`
        select public.create_assignment_with_delivery_v7(
          'Point timeout fixture',
          '${ids.dataset}',
          array['${ids.units[0]}'::uuid, '${ids.units[4]}'::uuid],
          4,
          100::smallint,
          300,
          100::smallint,
          true,
          100::smallint,
          'fixed',
          null,
          array['${ids.student}'::uuid],
          'per_question',
          300,
          $questions$${mixedQuestions}$questions$::jsonb
        ) as assignment_id;
      `);
      await database.exec("reset role;");

      const attempt = await database.query<{ attempt_id: string }>(`
        select public.create_quiz_attempt_from_bank(
          '${ids.student}',
          '${created.rows[0]!.assignment_id}'
        ) as attempt_id;
      `);
      const attemptId = attempt.rows[0]!.attempt_id;
      const questions = await database.query<{
        correct_choice_index: number;
        id: string;
      }>(`
        select id, correct_choice_index
        from public.quiz_questions
        where attempt_id = '${attemptId}'
        order by order_index;
      `);
      const timeoutTarget = questions.rows.at(-1)!;

      for (const [index, question] of questions.rows.entries()) {
        const isLast = index === questions.rows.length - 1;
        if (isLast) {
          await database.exec(`
            update public.quiz_attempts
            set current_question_started_at =
              clock_timestamp() - interval '10 minutes'
            where id = '${attemptId}';
          `);
        }
        await database.query(`
          select public.answer_quiz_question_v4(
            '${ids.student}',
            '${attemptId}',
            '${question.id}',
            'initial',
            ${question.correct_choice_index}::smallint,
            ${isLast}
          );
        `);
        const nextQuestion = questions.rows[index + 1];
        if (nextQuestion) {
          await database.query(`
            select public.resume_quiz_after_feedback_v2(
              '${ids.student}',
              '${attemptId}',
              '${nextQuestion.id}',
              'initial',
              0
            );
          `);
        }
      }

      const initialTimeout = await database.query<{
        delta: number;
        outcome: string;
        stage: string;
      }>(`
        select stage, outcome, delta
        from public.student_point_events
        where quiz_question_id = '${timeoutTarget.id}'
        order by stage;
      `);
      expect(initialTimeout.rows).toEqual([
        { stage: "initial", outcome: "timeout", delta: -3 },
      ]);

      await database.query(`
        select public.start_quiz_retry_v2(
          '${ids.student}',
          '${attemptId}'
        );
      `);
      await database.exec(`
        update public.quiz_attempts
        set current_question_started_at =
          clock_timestamp() - interval '10 minutes'
        where id = '${attemptId}';
      `);
      await database.query(`
        select public.answer_quiz_question_v4(
          '${ids.student}',
          '${attemptId}',
          '${timeoutTarget.id}',
          'retry',
          ${timeoutTarget.correct_choice_index}::smallint,
          true
        );
      `);

      const timeoutEvents = await database.query<{
        delta: number;
        outcome: string;
        stage: string;
      }>(`
        select stage, outcome, delta
        from public.student_point_events
        where quiz_question_id = '${timeoutTarget.id}'
        order by stage;
      `);
      expect(timeoutEvents.rows).toEqual([
        { stage: "initial", outcome: "timeout", delta: -3 },
        { stage: "retry", outcome: "timeout", delta: 0 },
      ]);

      const pointTotal = await database.query<{
        event_count: number;
        last_event_matches: boolean;
        ledger_sum: number;
        total_points: number;
      }>(`
        select
          total.total_points::integer,
          total.event_count::integer,
          sum(event.delta)::integer as ledger_sum,
          total.last_event_at = max(event.occurred_at) as last_event_matches
        from public.student_point_totals as total
        join public.student_point_events as event
          on event.student_id = total.student_id
        where total.student_id = '${ids.student}'
        group by
          total.total_points,
          total.event_count,
          total.last_event_at;
      `);
      expect(pointTotal.rows).toEqual([{
        total_points: 3,
        event_count: 5,
        ledger_sum: 3,
        last_event_matches: true,
      }]);
    } finally {
      await database.close();
    }
  }, 60_000);

  it("does not backfill or score an attempt created before the point migration", async () => {
    let historicalAttemptId = "";
    const database = await createFinalSchemaDatabase({
      beforeMigration: async (migrationDatabase, migrationName) => {
        if (
          migrationName !==
          "20260825083542_add_student_point_ledger.sql"
        ) {
          return;
        }
        await seedReviewAssignmentScenario(migrationDatabase);
        await migrationDatabase.exec(
          "delete from public.student_vocab_review_queue;",
        );
        historicalAttemptId = (
          await createRegularPointAttempt(
            migrationDatabase,
            "Historical point fixture",
          )
        ).attemptId;
      },
    });
    try {
      expect(historicalAttemptId).not.toBe("");
      const snapshot = await database.query<{
        point_rule_version_snapshot: string | null;
      }>(`
        select point_rule_version_snapshot
        from public.quiz_attempts
        where id = '${historicalAttemptId}';
      `);
      expect(snapshot.rows).toEqual([
        { point_rule_version_snapshot: null },
      ]);

      await database.exec(`
        update public.quiz_attempts
        set
          started_at = clock_timestamp() - interval '20 minutes',
          current_question_started_at =
            clock_timestamp() - interval '20 minutes',
          deadline_at = clock_timestamp() - interval '10 minutes'
        where id = '${historicalAttemptId}';
      `);
      await database.exec(`
        select set_config(
          'request.jwt.claim.role',
          'service_role',
          false
        );
        select set_config(
          'request.jwt.claims',
          '{"role":"service_role"}',
          false
        );
      `);
      const finalized = await database.query<{ count: number }>(`
        select public.finalize_stale_quiz_attempts(10) as count;
      `);
      expect(finalized.rows).toEqual([{ count: 1 }]);

      const points = await database.query<{ count: number }>(`
        select count(*)::integer as count
        from public.student_point_events
        where quiz_attempt_id = '${historicalAttemptId}';
      `);
      expect(points.rows).toEqual([{ count: 0 }]);
    } finally {
      await database.close();
    }
  }, 60_000);

  it("records initial unanswered outcomes through the stale-attempt batch once", async () => {
    const database = await createFinalSchemaDatabase();
    try {
      await seedReviewAssignmentScenario(database);
      await database.exec("delete from public.student_vocab_review_queue;");
      const { attemptId } = await createRegularPointAttempt(
        database,
        "Initial stale point fixture",
      );
      await database.exec(`
        update public.quiz_attempts
        set
          started_at = clock_timestamp() - interval '20 minutes',
          current_question_started_at =
            clock_timestamp() - interval '20 minutes',
          deadline_at = clock_timestamp() - interval '10 minutes'
        where id = '${attemptId}';
      `);

      const first = await database.query<{
        result: {
          failedCount: number;
          pendingCount: number;
          processedCount: number;
        };
      }>(`
        select private.run_stale_quiz_attempt_maintenance_v1(
          10,
          10,
          1000
        ) as result;
      `);
      const second = await database.query<{
        result: {
          failedCount: number;
          pendingCount: number;
          processedCount: number;
        };
      }>(`
        select private.run_stale_quiz_attempt_maintenance_v1(
          10,
          10,
          1000
        ) as result;
      `);
      expect(first.rows[0]?.result).toMatchObject({
        processedCount: 1,
        failedCount: 0,
        pendingCount: 0,
      });
      expect(second.rows[0]?.result).toMatchObject({
        processedCount: 0,
        failedCount: 0,
        pendingCount: 0,
      });

      const events = await database.query<{
        delta: number;
        outcome: string;
        stage: string;
      }>(`
        select stage, outcome, delta
        from public.student_point_events
        where quiz_attempt_id = '${attemptId}'
        order by quiz_question_id;
      `);
      expect(events.rows).toHaveLength(4);
      expect(events.rows).toEqual(
        events.rows.map(() => ({
          stage: "initial",
          outcome: "unanswered",
          delta: -3,
        })),
      );

      const total = await database.query<{
        event_count: number;
        ledger_sum: number;
        total_points: number;
      }>(`
        select
          total.total_points::integer,
          total.event_count::integer,
          sum(event.delta)::integer as ledger_sum
        from public.student_point_totals as total
        join public.student_point_events as event
          on event.student_id = total.student_id
        where total.student_id = '${ids.student}'
        group by total.total_points, total.event_count;
      `);
      expect(total.rows).toEqual([{
        total_points: -12,
        event_count: 4,
        ledger_sum: -12,
      }]);
    } finally {
      await database.close();
    }
  }, 60_000);

  it("records retry unanswered outcomes through the stale-attempt batch once", async () => {
    const database = await createFinalSchemaDatabase();
    try {
      await seedReviewAssignmentScenario(database);
      await database.exec("delete from public.student_vocab_review_queue;");
      const { attemptId, questions } = await createRegularPointAttempt(
        database,
        "Retry stale point fixture",
      );
      const retryTarget = questions[0]!;

      for (const [index, question] of questions.entries()) {
        const choice = index === 0
          ? (question.correct_choice_index + 1) % 4
          : question.correct_choice_index;
        await database.query(`
          select public.answer_quiz_question_v4(
            '${ids.student}',
            '${attemptId}',
            '${question.id}',
            'initial',
            ${choice}::smallint,
            false
          );
        `);
        const nextQuestion = questions[index + 1];
        if (nextQuestion) {
          await database.query(`
            select public.resume_quiz_after_feedback_v2(
              '${ids.student}',
              '${attemptId}',
              '${nextQuestion.id}',
              'initial',
              0
            );
          `);
        }
      }

      await database.query(`
        select public.start_quiz_retry_v2(
          '${ids.student}',
          '${attemptId}'
        );
      `);
      await database.exec(`
        update public.quiz_attempts
        set
          started_at = clock_timestamp() - interval '20 minutes',
          initial_completed_at = clock_timestamp() - interval '10 minutes',
          retry_started_at = clock_timestamp() - interval '5 minutes',
          current_question_started_at =
            clock_timestamp() - interval '5 minutes',
          deadline_at = clock_timestamp() - interval '1 minute'
        where id = '${attemptId}';
      `);
      await database.exec(`
        select set_config(
          'request.jwt.claim.role',
          'service_role',
          false
        );
        select set_config(
          'request.jwt.claims',
          '{"role":"service_role"}',
          false
        );
      `);

      const first = await database.query<{ finalized: number }>(`
        select public.finalize_stale_quiz_attempts(10) as finalized;
      `);
      const second = await database.query<{ finalized: number }>(`
        select public.finalize_stale_quiz_attempts(10) as finalized;
      `);
      expect(first.rows).toEqual([{ finalized: 1 }]);
      expect(second.rows).toEqual([{ finalized: 0 }]);

      const targetEvents = await database.query<{
        delta: number;
        outcome: string;
        stage: string;
      }>(`
        select stage, outcome, delta
        from public.student_point_events
        where quiz_question_id = '${retryTarget.id}'
        order by stage;
      `);
      expect(targetEvents.rows).toEqual([
        { stage: "initial", outcome: "wrong", delta: -3 },
        { stage: "retry", outcome: "unanswered", delta: 0 },
      ]);

      const total = await database.query<{
        event_count: number;
        ledger_sum: number;
        total_points: number;
      }>(`
        select
          total.total_points::integer,
          total.event_count::integer,
          sum(event.delta)::integer as ledger_sum
        from public.student_point_totals as total
        join public.student_point_events as event
          on event.student_id = total.student_id
        where total.student_id = '${ids.student}'
        group by total.total_points, total.event_count;
      `);
      expect(total.rows).toEqual([{
        total_points: 3,
        event_count: 5,
        ledger_sum: 3,
      }]);
    } finally {
      await database.close();
    }
  }, 60_000);

  it("finds unresolved wrong words without a manual queue and creates the direct review assignment idempotently", async () => {
    const directReviewDatabase = await createFinalSchemaDatabase();
    try {
      await seedReviewAssignmentScenario(directReviewDatabase);
      await directReviewDatabase.exec(
        "delete from public.student_vocab_review_queue;",
      );

      await directReviewDatabase.exec("set role authenticated;");
      const sourceAssignment = await directReviewDatabase.query<{
        assignment_id: string;
      }>(`
        select public.create_assignment_with_delivery_v7(
          'Current wrong source fixture',
          '${ids.dataset}',
          array['${ids.units[0]}'::uuid, '${ids.units[4]}'::uuid],
          4,
          100::smallint,
          300,
          80::smallint,
          false,
          null,
          'fixed',
          null,
          array['${ids.student}'::uuid],
          'total',
          null,
          $questions$${mixedQuestions}$questions$::jsonb
        ) as assignment_id;
      `);
      await directReviewDatabase.exec("reset role;");

      const sourceAttempt = await directReviewDatabase.query<{
        attempt_id: string;
      }>(`
        select public.create_quiz_attempt_from_bank(
          '${ids.student}',
          '${sourceAssignment.rows[0]!.assignment_id}'
        ) as attempt_id;
      `);
      const sourceAttemptId = sourceAttempt.rows[0]!.attempt_id;
      const sourceQuestions = await directReviewDatabase.query<{
        correct_choice_index: number;
        id: string;
        vocab_entry_id: number;
      }>(`
        select id, vocab_entry_id, correct_choice_index
        from public.quiz_questions
        where attempt_id = '${sourceAttemptId}'
        order by order_index;
      `);
      for (const [index, question] of sourceQuestions.rows.entries()) {
        const choice = index === 0
          ? (question.correct_choice_index + 1) % 4
          : question.correct_choice_index;
        await directReviewDatabase.query(`
          select public.answer_quiz_question_v4(
            '${ids.student}',
            '${sourceAttemptId}',
            '${question.id}',
            'initial',
            ${choice}::smallint,
            false
          );
        `);
        const nextQuestion = sourceQuestions.rows[index + 1];
        if (nextQuestion) {
          await directReviewDatabase.query(`
            select public.resume_quiz_after_feedback_v2(
              '${ids.student}',
              '${sourceAttemptId}',
              '${nextQuestion.id}',
              'initial',
              0
            );
          `);
        }
      }

      const manualQueue = await directReviewDatabase.query<{ count: number }>(`
        select count(*)::integer as count
        from public.student_vocab_review_queue
        where student_id = '${ids.student}';
      `);
      expect(manualQueue.rows[0]?.count).toBe(0);

      await directReviewDatabase.exec("set role authenticated;");
      const summaries = await directReviewDatabase.query<{
        dataset_id: string;
        level_1_count: number;
        level_2_count: number;
        total_count: number;
      }>(`
        select dataset_id, level_1_count, level_2_count, total_count
        from public.list_student_direct_review_dataset_summaries_v1(
          '${ids.student}'
        );
      `);
      const candidates = await directReviewDatabase.query<{
        existing_queue_id: string | null;
        reason_level: number;
        source_question_id: string;
        vocab_entry_id: number;
        wrong_count: number;
      }>(`
        select
          source_question_id,
          vocab_entry_id,
          reason_level,
          wrong_count,
          existing_queue_id
        from public.list_student_direct_review_candidates_v1(
          '${ids.student}',
          '${ids.dataset}',
          array[1]::smallint[],
          400
        );
      `);
      expect(summaries.rows).toEqual([{
        dataset_id: ids.dataset,
        level_1_count: 1,
        level_2_count: 0,
        total_count: 1,
      }]);
      expect(candidates.rows).toHaveLength(1);
      expect(candidates.rows[0]).toMatchObject({
        existing_queue_id: null,
        reason_level: 1,
        vocab_entry_id: sourceQuestions.rows[0]!.vocab_entry_id,
        wrong_count: 1,
      });

      const requestKey = "00000000-0000-4000-8000-000000000888";
      const requestHash = "8".repeat(64);
      const selectedCandidate = candidates.rows[0]!;
      const directQuestion = JSON.stringify([{
        vocab_entry_id: selectedCandidate.vocab_entry_id,
        base_order_index: 1,
        direction: "english_to_korean",
        choice_vocab_entry_ids: [1, 2, 3, 4],
      }]);
      await expectPostgresError(
        directReviewDatabase.query(
          `select public.create_current_wrong_review_assignment_v1(
            $1::uuid,
            $2::uuid,
            array[1]::smallint[],
            array['00000000-0000-4000-8000-000000000777'::uuid],
            '00000000-0000-4000-8000-000000000887'::uuid,
            $3::text,
            'Stale current wrong direct review',
            100::smallint,
            300,
            80::smallint,
            true,
            80::smallint,
            'fixed',
            null,
            'total',
            null,
            $4::jsonb
          )`,
          [ids.student, ids.dataset, "7".repeat(64), directQuestion],
        ),
        "40001",
        "current_wrong_review_snapshot_changed",
      );
      await directReviewDatabase.exec("reset role;");
      const rolledBack = await directReviewDatabase.query<{
        assignment_count: number;
        queue_count: number;
        request_count: number;
      }>(`
        select
          (
            select count(*)::integer
            from public.assignments
            where title = 'Stale current wrong direct review'
          ) as assignment_count,
          (
            select count(*)::integer
            from public.student_vocab_review_queue
            where student_id = '${ids.student}'
          ) as queue_count,
          (
            select count(*)::integer
            from private.current_wrong_review_assignment_requests
            where idempotency_key =
              '00000000-0000-4000-8000-000000000887'
          ) as request_count;
      `);
      expect(rolledBack.rows[0]).toEqual({
        assignment_count: 0,
        queue_count: 0,
        request_count: 0,
      });
      await directReviewDatabase.exec("set role authenticated;");

      const expiredRequestKey = "00000000-0000-4000-8000-000000000889";
      await expectPostgresError(
        directReviewDatabase.query(
          `select public.create_current_wrong_review_assignment_v1(
            $1::uuid,
            $2::uuid,
            array[1]::smallint[],
            array[$3::uuid],
            $4::uuid,
            $5::text,
            'Expired current wrong direct review',
            100::smallint,
            300,
            80::smallint,
            true,
            80::smallint,
            'fixed',
            '2000-01-01T00:00:00Z'::timestamptz,
            'total',
            null,
            $6::jsonb
          )`,
          [
            ids.student,
            ids.dataset,
            selectedCandidate.source_question_id,
            expiredRequestKey,
            "6".repeat(64),
            directQuestion,
          ],
        ),
        "22023",
        "assignment_deadline_must_be_future",
      );
      await directReviewDatabase.exec("reset role;");
      const expiredRollback = await directReviewDatabase.query<{
        assignment_count: number;
        audit_count: number;
        queue_count: number;
        request_count: number;
      }>(`
        select
          (
            select count(*)::integer
            from public.assignments
            where title = 'Expired current wrong direct review'
          ) as assignment_count,
          (
            select count(*)::integer
            from public.audit_events
            where event_type = 'assignment.current_wrong_review_v1_created'
          ) as audit_count,
          (
            select count(*)::integer
            from public.student_vocab_review_queue
            where student_id = '${ids.student}'
          ) as queue_count,
          (
            select count(*)::integer
            from private.current_wrong_review_assignment_requests
            where idempotency_key = '${expiredRequestKey}'
          ) as request_count;
      `);
      expect(expiredRollback.rows[0]).toEqual({
        assignment_count: 0,
        audit_count: 0,
        queue_count: 0,
        request_count: 0,
      });
      await directReviewDatabase.exec("set role authenticated;");

      const createDirectReview = (
        availableFrom: string | null,
        availableUntil: string | null,
      ) =>
        directReviewDatabase.query<{
        assignment_id: string;
      }>(
        `select public.create_current_wrong_review_assignment_v2(
          $1::uuid,
          $2::uuid,
          array[1]::smallint[],
          array[$3::uuid],
          $4::uuid,
          $5::text,
          'Current wrong direct review',
          100::smallint,
          300,
          80::smallint,
          true,
            80::smallint,
            'fixed',
            $7::timestamptz,
            $8::timestamptz,
            'total',
          null,
          $6::jsonb
        ) as assignment_id`,
        [
          ids.student,
          ids.dataset,
          selectedCandidate.source_question_id,
          requestKey,
          requestHash,
          directQuestion,
          availableFrom,
          availableUntil,
        ],
      );
      const directSchedule = {
        availableFrom: "2020-01-01T00:00:00.000Z",
        availableUntil: "2030-01-03T00:00:00.000Z",
      };
      const firstCreation = await createDirectReview(
        directSchedule.availableFrom,
        directSchedule.availableUntil,
      );
      const replayedCreation = await createDirectReview(
        directSchedule.availableFrom,
        directSchedule.availableUntil,
      );
      expect(replayedCreation.rows[0]?.assignment_id).toBe(
        firstCreation.rows[0]?.assignment_id,
      );
      await expectPostgresError(
        createDirectReview(
          "2021-01-01T00:00:00.000Z",
          directSchedule.availableUntil,
        ),
        "23505",
        "idempotency_key_reused",
      );
      await expectPostgresError(
        directReviewDatabase.query(
          `select public.get_current_wrong_review_assignment_result_v1(
            $1::uuid,
            $2::uuid,
            $3::uuid,
            $4::text
          )`,
          [ids.student, ids.dataset, requestKey, "9".repeat(64)],
        ),
        "23505",
        "idempotency_key_reused",
      );

      await directReviewDatabase.exec("reset role;");
      const persisted = await directReviewDatabase.query<{
        assignment_count: number;
        audit_count: number;
        completed_request_count: number;
        queue_count: number;
        target_count: number;
        available_from_matches: boolean;
        available_until_matches: boolean;
      }>(`
        select
          (
            select count(*)::integer
            from public.assignments
            where id = '${firstCreation.rows[0]!.assignment_id}'
          ) as assignment_count,
          (
            select count(*)::integer
            from public.audit_events
            where event_type =
              'assignment.current_wrong_review_v1_created'
          ) as audit_count,
          (
            select count(*)::integer
            from private.current_wrong_review_assignment_requests
            where idempotency_key = '${requestKey}'
              and assignment_id = '${firstCreation.rows[0]!.assignment_id}'
              and completed_at is not null
          ) as completed_request_count,
          (
            select count(*)::integer
            from public.student_vocab_review_queue
            where student_id = '${ids.student}'
              and status = 'pending'
          ) as queue_count,
          (
            select count(*)::integer
            from public.assignment_review_targets
            where assignment_id = '${firstCreation.rows[0]!.assignment_id}'
          ) as target_count,
          (
            select assignment.available_from =
              '${directSchedule.availableFrom}'::timestamptz
            from public.assignments as assignment
            where assignment.id = '${firstCreation.rows[0]!.assignment_id}'
          ) as available_from_matches,
          (
            select assignment.available_until =
              '${directSchedule.availableUntil}'::timestamptz
            from public.assignments as assignment
            where assignment.id = '${firstCreation.rows[0]!.assignment_id}'
          ) as available_until_matches;
      `);
      expect(persisted.rows[0]).toEqual({
        assignment_count: 1,
        audit_count: 1,
        completed_request_count: 1,
        queue_count: 1,
        target_count: 1,
        available_from_matches: true,
        available_until_matches: true,
      });

      await directReviewDatabase.exec("set role authenticated;");
      const remaining = await directReviewDatabase.query<{
        total_count: number;
      }>(`
        select total_count
        from public.list_student_direct_review_dataset_summaries_v1(
          '${ids.student}'
        );
      `);
      expect(remaining.rows).toEqual([]);
      await directReviewDatabase.exec("reset role;");

      const reviewAttempt = await directReviewDatabase.query<{
        attempt_id: string;
      }>(`
        select public.create_quiz_attempt_from_bank(
          '${ids.student}',
          '${firstCreation.rows[0]!.assignment_id}'
        ) as attempt_id;
      `);
      const reviewAttemptState = await directReviewDatabase.query<{
        question_count: number;
        question_count_snapshot: number;
      }>(`
        select
          attempt.question_count_snapshot,
          (
            select count(*)::integer
            from public.quiz_questions as question
            where question.attempt_id = attempt.id
          ) as question_count
        from public.quiz_attempts as attempt
        where attempt.id = '${reviewAttempt.rows[0]!.attempt_id}';
      `);
      expect(reviewAttemptState.rows[0]).toEqual({
        question_count: 1,
        question_count_snapshot: 1,
      });
    } finally {
      await directReviewDatabase.close();
    }
  }, 60_000);

  it("creates a one-question direct review assignment and starts its quiz attempt", async () => {
    const directReviewDatabase = await createFinalSchemaDatabase();
    try {
      await seedReviewAssignmentScenario(directReviewDatabase);
      const privileges = await directReviewDatabase.query<{
        anon_execute: boolean;
        authenticated_execute: boolean;
        service_execute: boolean;
      }>(`
        select
          has_function_privilege(
            'anon',
            'private.create_exact_review_assignment_v5(uuid,uuid,uuid[],text,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)',
            'execute'
          ) as anon_execute,
          has_function_privilege(
            'authenticated',
            'private.create_exact_review_assignment_v5(uuid,uuid,uuid[],text,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)',
            'execute'
          ) as authenticated_execute,
          has_function_privilege(
            'service_role',
            'private.create_exact_review_assignment_v5(uuid,uuid,uuid[],text,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)',
            'execute'
          ) as service_execute;
      `);
      expect(privileges.rows[0]).toEqual({
        anon_execute: false,
        authenticated_execute: true,
        service_execute: true,
      });
      const oneQuestion = JSON.stringify([
        {
          vocab_entry_id: 1,
          base_order_index: 1,
          direction: "english_to_korean",
          choice_vocab_entry_ids: [1, 2, 3, 4],
        },
      ]);

      await directReviewDatabase.exec("set role authenticated;");
      const created = await directReviewDatabase.query<{
        assignment_id: string;
      }>(`
        select public.create_exact_review_assignment_v7(
          '${ids.student}',
          '${ids.dataset}',
          array['${ids.selectedQueue}'::uuid],
          'One-word direct review',
          100::smallint,
          300,
          80::smallint,
          true,
          80::smallint,
          'fixed',
          null,
          'total',
          null,
          $questions$${oneQuestion}$questions$::jsonb
        ) as assignment_id;
      `);
      await directReviewDatabase.exec("reset role;");
      const assignmentId = created.rows[0]!.assignment_id;

      const assignment = await directReviewDatabase.query<{
        assignment_purpose: string;
        question_count: number;
        question_bank_count: number;
        review_target_count: number;
      }>(`
        select
          assignment.assignment_purpose,
          assignment.question_count,
          (
            select count(*)::integer
            from public.assignment_questions as question
            where question.assignment_id = assignment.id
          ) as question_bank_count,
          (
            select count(*)::integer
            from public.assignment_review_targets as target
            where target.assignment_id = assignment.id
          ) as review_target_count
        from public.assignments as assignment
        where assignment.id = '${assignmentId}';
      `);
      expect(assignment.rows[0]).toEqual({
        assignment_purpose: "review",
        question_count: 1,
        question_bank_count: 1,
        review_target_count: 1,
      });

      const attempt = await directReviewDatabase.query<{
        attempt_id: string;
      }>(`
        select public.create_quiz_attempt_from_bank(
          '${ids.student}',
          '${assignmentId}'
        ) as attempt_id;
      `);
      const attemptState = await directReviewDatabase.query<{
        question_count_snapshot: number;
        question_count: number;
      }>(`
        select
          attempt.question_count_snapshot,
          (
            select count(*)::integer
            from public.quiz_questions as question
            where question.attempt_id = attempt.id
          ) as question_count
        from public.quiz_attempts as attempt
        where attempt.id = '${attempt.rows[0]!.attempt_id}';
      `);
      expect(attemptState.rows[0]).toEqual({
        question_count_snapshot: 1,
        question_count: 1,
      });
    } finally {
      await directReviewDatabase.close();
    }
  }, 60_000);
});

describe.sequential("admin history read model", () => {
  it("keeps 0/1/10/11/21 boundaries and a stable keyset snapshot", async () => {
    const database = await createFinalSchemaDatabase();
    const assignmentIds = Array.from(
      { length: 21 },
      (_, index) =>
        `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const assignmentValues = assignmentIds.map((assignmentId, index) => {
      const markers = ["R3 twentyone"];
      if (index < 11) markers.push("R3 eleven");
      if (index < 10) markers.push("R3 ten");
      if (index === 0) markers.push("R3 one");
      return `(
        '${assignmentId}',
        '${markers.join(" ")}',
        '${ids.dataset}',
        1,
        1,
        1,
        100,
        60,
        80,
        'active',
        '2026-08-01T00:00:00Z',
        '${ids.admin}',
        'source_rows',
        'fixed',
        null
      )`;
    }).join(",");
    const recipientValues = assignmentIds.map((assignmentId) => `(
      '${assignmentId}',
      '${ids.student}',
      '${ids.admin}',
      '2026-08-28T00:00:00Z'
    )`).join(",");
    const unitValues = assignmentIds.map((assignmentId) => `(
      '${assignmentId}',
      '${ids.dataset}',
      '${ids.units[0]}',
      1,
      true
    )`).join(",");
    const infiniteDeadlineAttemptValues = assignmentIds
      .slice(0, 12)
      .map((assignmentId, index) => `(
        '20000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}',
        '${ids.student}',
        '${assignmentId}',
        1,
        'expired',
        'completed',
        '2026-08-28T01:00:00Z',
        'infinity',
        '2026-08-29T00:00:00Z'::timestamptz + interval '${index} minutes',
        1,
        60,
        80,
        'initial',
        0,
        0,
        1,
        0,
        0,
        false,
        10
      )`)
      .join(",");

    type InitialRow = {
      group_key: string;
      items: Array<{
        effectiveAt: string | Date;
        entryKey: string;
        item: {
          assignmentTitle: string;
          completedAt?: string | Date | null;
        };
      }>;
      snapshot_at: string | Date;
      total_count: number | bigint;
    };

    try {
      await seedReviewAssignmentScenario(database);
      await database.exec(`
        insert into public.assignments (
          id,
          title,
          dataset_id,
          range_start,
          range_end,
          question_count,
          english_to_korean_ratio,
          time_limit_seconds,
          passing_score,
          status,
          available_from,
          created_by,
          range_basis,
          question_order_mode,
          question_bank_version
        )
        values ${assignmentValues};

        insert into public.assignment_units (
          assignment_id,
          dataset_id,
          unit_id,
          position,
          is_primary
        )
        values ${unitValues};

        insert into public.assignment_students (
          assignment_id,
          student_id,
          assigned_by,
          assigned_at
        )
        values ${recipientValues};

        set role authenticated;
      `);

      async function readInitial(query: string) {
        return database.query<InitialRow>(`
          select *
          from public.get_admin_history_initial_v1(
            $1,
            'all',
            false,
            null,
            11
          )
        `, [query]);
      }

      const none = await readInitial("R3 none");
      const one = await readInitial("R3 one");
      const ten = await readInitial("R3 ten");
      const eleven = await readInitial("R3 eleven");
      const twentyOne = await readInitial("R3 twentyone");
      const studentNameResults = await readInitial("Test student");

      const openRow = (rows: InitialRow[]) =>
        rows.find((row) => row.group_key === "open")!;
      expect(Number(openRow(none.rows).total_count)).toBe(0);
      expect(openRow(none.rows).items).toHaveLength(0);
      expect(Number(openRow(one.rows).total_count)).toBe(1);
      expect(openRow(one.rows).items).toHaveLength(1);
      expect(Number(openRow(ten.rows).total_count)).toBe(10);
      expect(openRow(ten.rows).items).toHaveLength(10);
      expect(Number(openRow(eleven.rows).total_count)).toBe(11);
      expect(openRow(eleven.rows).items).toHaveLength(11);

      const firstPage = openRow(twentyOne.rows);
      expect(Number(firstPage.total_count)).toBe(21);
      expect(firstPage.items).toHaveLength(11);
      expect(new Set(twentyOne.rows.map(
        (row) => new Date(row.snapshot_at).toISOString(),
      )).size).toBe(1);
      const stableSnapshotAt = new Date(firstPage.snapshot_at).toISOString();
      const firstCursor = firstPage.items[9]!;
      const firstCursorEffectiveAt = new Date(
        firstCursor.effectiveAt,
      ).toISOString();

      await database.exec(`
        reset role;
        insert into public.assignments (
          id,
          title,
          dataset_id,
          range_start,
          range_end,
          question_count,
          english_to_korean_ratio,
          time_limit_seconds,
          passing_score,
          status,
          available_from,
          created_by,
          range_basis,
          question_order_mode,
          question_bank_version
        ) values (
          '10000000-0000-4000-8000-000000000099',
          'R3 twentyone inserted after snapshot',
          '${ids.dataset}',
          1,
          1,
          1,
          100,
          60,
          80,
          'active',
          '2026-08-01T00:00:00Z',
          '${ids.admin}',
          'source_rows',
          'fixed',
          null
        );
        insert into public.assignment_units (
          assignment_id,
          dataset_id,
          unit_id,
          position,
          is_primary
        ) values (
          '10000000-0000-4000-8000-000000000099',
          '${ids.dataset}',
          '${ids.units[0]}',
          1,
          true
        );
        insert into public.assignment_students (
          assignment_id,
          student_id,
          assigned_by,
          assigned_at
        ) values (
          '10000000-0000-4000-8000-000000000099',
          '${ids.student}',
          '${ids.admin}',
          '${stableSnapshotAt}'::timestamptz + interval '1 second'
        );
        set role authenticated;
      `);

      const secondPage = await database.query<{
        cursor_effective_at: string | Date;
        cursor_entry_key: string;
      }>(`
        select *
        from public.list_admin_history_page_v1(
          'R3 twentyone',
          'all',
          false,
          'open',
          '${stableSnapshotAt}',
          '${firstCursorEffectiveAt}',
          '${firstCursor.entryKey}',
          11
        )
      `);
      expect(secondPage.rows).toHaveLength(11);
      const secondCursor = secondPage.rows[9]!;
      const secondCursorEffectiveAt = new Date(
        secondCursor.cursor_effective_at,
      ).toISOString();
      const finalPage = await database.query<{
        cursor_entry_key: string;
      }>(`
        select *
        from public.list_admin_history_page_v1(
          'R3 twentyone',
          'all',
          false,
          'open',
          '${stableSnapshotAt}',
          '${secondCursorEffectiveAt}',
          '${secondCursor.cursor_entry_key}',
          11
        )
      `);
      expect(finalPage.rows).toHaveLength(1);

      const visibleKeys = [
        ...firstPage.items.slice(0, 10).map((item) => item.entryKey),
        ...secondPage.rows.slice(0, 10).map((item) => item.cursor_entry_key),
        ...finalPage.rows.map((item) => item.cursor_entry_key),
      ];
      expect(new Set(visibleKeys).size).toBe(21);
      expect(visibleKeys).not.toContain(
        "assignment.10000000-0000-4000-8000-000000000099." + ids.student,
      );

      const studentNamePage = openRow(studentNameResults.rows);
      const studentNameCursor = studentNamePage.items[9]!;
      await database.exec(`
        reset role;
        update public.students
        set display_name = 'Renamed student'
        where id = '${ids.student}';
        set role authenticated;
      `);
      const changedSearchPage = await database.query(`
        select *
        from public.list_admin_history_page_v1(
          'Test student',
          'all',
          false,
          'open',
          '${new Date(studentNamePage.snapshot_at).toISOString()}',
          '${new Date(studentNameCursor.effectiveAt).toISOString()}',
          '${studentNameCursor.entryKey}',
          11
        )
      `);
      expect(changedSearchPage.rows).toHaveLength(0);
      await database.exec(`
        reset role;
        update public.students
        set display_name = 'Test student'
        where id = '${ids.student}';
        set role authenticated;
      `);

      const detail = await database.query<{ title: string }>(`
        select public.get_admin_history_detail_v1(
          null,
          '${assignmentIds[0]}',
          '${ids.student}'
        ) ->> 'assignmentTitle' as title
      `);
      expect(detail.rows[0]?.title).toContain("R3 one");

      await database.exec(`
        reset role;
        insert into public.quiz_attempts (
          id,
          student_id,
          assignment_id,
          attempt_number,
          status,
          phase,
          started_at,
          deadline_at,
          completed_at,
          question_count_snapshot,
          time_limit_seconds_snapshot,
          passing_score_snapshot,
          passing_basis_snapshot,
          initial_correct_count,
          retry_correct_count,
          unresolved_wrong_count,
          initial_score,
          final_score,
          passed,
          elapsed_seconds
        ) values ${infiniteDeadlineAttemptValues};
        set role authenticated;
      `);

      const infiniteSnapshotAt = "2026-08-30T00:00:00.000Z";
      const infiniteDeadlineInitial = await database.query<InitialRow>(`
        select *
        from public.get_admin_history_initial_v1(
          'R3 twentyone',
          'all',
          false,
          '${infiniteSnapshotAt}',
          11
        )
      `);
      const infiniteDeadlineSection = infiniteDeadlineInitial.rows.find(
        (row) => row.group_key === "needs_attention",
      )!;
      expect(Number(infiniteDeadlineSection.total_count)).toBe(12);
      expect(infiniteDeadlineSection.items).toHaveLength(11);
      for (const item of infiniteDeadlineSection.items) {
        const effectiveAt = new Date(item.effectiveAt);
        const completedAt = new Date(item.item.completedAt!);
        expect(Number.isFinite(effectiveAt.getTime())).toBe(true);
        expect(effectiveAt.toISOString()).toBe(completedAt.toISOString());
      }

      const infiniteDeadlineCursor = infiniteDeadlineSection.items[9]!;
      const infiniteDeadlineNextPage = await database.query<{
        cursor_effective_at: string | Date;
        cursor_entry_key: string;
        item: { completedAt: string | Date | null };
      }>(`
        select *
        from public.list_admin_history_page_v1(
          'R3 twentyone',
          'all',
          false,
          'needs_attention',
          '${infiniteSnapshotAt}',
          '${new Date(infiniteDeadlineCursor.effectiveAt).toISOString()}',
          '${infiniteDeadlineCursor.entryKey}',
          11
        )
      `);
      expect(infiniteDeadlineNextPage.rows).toHaveLength(2);
      for (const row of infiniteDeadlineNextPage.rows) {
        const effectiveAt = new Date(row.cursor_effective_at);
        const completedAt = new Date(row.item.completedAt!);
        expect(Number.isFinite(effectiveAt.getTime())).toBe(true);
        expect(effectiveAt.toISOString()).toBe(completedAt.toISOString());
      }
      const infiniteDeadlineVisibleKeys = [
        ...infiniteDeadlineSection.items
          .slice(0, 10)
          .map((item) => item.entryKey),
        ...infiniteDeadlineNextPage.rows.map((row) => row.cursor_entry_key),
      ];
      expect(infiniteDeadlineVisibleKeys).toHaveLength(12);
      expect(new Set(infiniteDeadlineVisibleKeys).size).toBe(12);

      await database.exec(`
        reset role;
        insert into public.assignments (
          id,
          title,
          dataset_id,
          range_start,
          range_end,
          question_count,
          english_to_korean_ratio,
          time_limit_seconds,
          passing_score,
          status,
          available_from,
          created_by,
          range_basis,
          question_order_mode,
          question_bank_version
        ) values
          (
            '10000000-0000-4000-8000-000000000101',
            'R3 phase initial boundary',
            '${ids.dataset}', 1, 1, 1, 100, 60, 80, 'active',
            '2026-08-20T00:00:00Z', '${ids.admin}', 'source_rows', 'fixed', null
          ),
          (
            '10000000-0000-4000-8000-000000000102',
            'R3 phase retry boundary',
            '${ids.dataset}', 1, 1, 1, 100, 60, 80, 'active',
            '2026-08-20T00:00:00Z', '${ids.admin}', 'source_rows', 'fixed', null
          );
        insert into public.assignment_units (
          assignment_id,
          dataset_id,
          unit_id,
          position,
          is_primary
        ) values
          (
            '10000000-0000-4000-8000-000000000101',
            '${ids.dataset}', '${ids.units[0]}', 1, true
          ),
          (
            '10000000-0000-4000-8000-000000000102',
            '${ids.dataset}', '${ids.units[0]}', 1, true
          );
        insert into public.assignment_students (
          assignment_id,
          student_id,
          assigned_by,
          assigned_at
        ) values
          (
            '10000000-0000-4000-8000-000000000101',
            '${ids.student}', '${ids.admin}', '2026-08-20T00:00:00Z'
          ),
          (
            '10000000-0000-4000-8000-000000000102',
            '${ids.student}', '${ids.admin}', '2026-08-20T00:00:00Z'
          );
        insert into public.quiz_attempts (
          id,
          student_id,
          assignment_id,
          attempt_number,
          status,
          phase,
          started_at,
          deadline_at,
          initial_completed_at,
          retry_started_at,
          question_count_snapshot,
          time_limit_seconds_snapshot,
          passing_score_snapshot,
          passing_basis_snapshot,
          initial_correct_count,
          retry_correct_count,
          unresolved_wrong_count,
          initial_score,
          elapsed_seconds
        ) values
          (
            '20000000-0000-4000-8000-000000000101',
            '${ids.student}',
            '10000000-0000-4000-8000-000000000101',
            1, 'in_progress', 'review',
            '2026-08-21T00:00:00Z', '2026-09-01T00:00:00Z',
            '2026-08-23T00:00:00Z', null,
            1, 60, 80, 'initial', 0, 0, 1, 0, 10
          ),
          (
            '20000000-0000-4000-8000-000000000102',
            '${ids.student}',
            '10000000-0000-4000-8000-000000000102',
            1, 'in_progress', 'retry',
            '2026-08-20T00:00:00Z', '2026-09-01T00:00:00Z',
            '2026-08-21T00:00:00Z', '2026-08-23T00:00:00Z',
            1, 60, 80, 'initial', 0, 0, 1, 0, 10
          );

        insert into public.assignments (
          id,
          title,
          dataset_id,
          range_start,
          range_end,
          question_count,
          english_to_korean_ratio,
          time_limit_seconds,
          passing_score,
          status,
          available_from,
          created_by,
          range_basis,
          question_order_mode,
          question_bank_version
        ) values (
          '10000000-0000-4000-8000-000000000103',
          'R3 expired snapshot boundary',
          '${ids.dataset}', 1, 1, 1, 100, 60, 80, 'active',
          '2026-08-20T00:00:00Z', '${ids.admin}', 'source_rows', 'fixed', null
        );
        insert into public.assignment_units (
          assignment_id,
          dataset_id,
          unit_id,
          position,
          is_primary
        ) values (
          '10000000-0000-4000-8000-000000000103',
          '${ids.dataset}', '${ids.units[0]}', 1, true
        );
        insert into public.assignment_students (
          assignment_id,
          student_id,
          assigned_by,
          assigned_at
        ) values (
          '10000000-0000-4000-8000-000000000103',
          '${ids.student}', '${ids.admin}', '2026-08-20T00:00:00Z'
        );
        insert into public.quiz_attempts (
          id,
          student_id,
          assignment_id,
          attempt_number,
          status,
          phase,
          started_at,
          deadline_at,
          completed_at,
          question_count_snapshot,
          time_limit_seconds_snapshot,
          passing_score_snapshot,
          passing_basis_snapshot,
          initial_correct_count,
          retry_correct_count,
          unresolved_wrong_count,
          initial_score,
          final_score,
          passed,
          elapsed_seconds
        ) values (
          '20000000-0000-4000-8000-000000000103',
          '${ids.student}',
          '10000000-0000-4000-8000-000000000103',
          1, 'expired', 'completed',
          '2026-08-20T00:00:00Z', '2026-08-22T00:00:00Z',
          '2026-08-24T00:00:00Z',
          1, 60, 80, 'initial', 0, 0, 1, 0, 0, false, 10
        );

        insert into public.assignments (
          id,
          title,
          dataset_id,
          range_start,
          range_end,
          question_count,
          english_to_korean_ratio,
          time_limit_seconds,
          passing_score,
          status,
          available_from,
          created_by,
          range_basis,
          question_order_mode,
          question_bank_version
        ) values (
          '10000000-0000-4000-8000-000000000104',
          'R3 hidden snapshot boundary',
          '${ids.dataset}', 1, 1, 1, 100, 60, 80, 'active',
          '2026-08-20T00:00:00Z', '${ids.admin}', 'source_rows', 'fixed', null
        );
        insert into public.assignment_units (
          assignment_id,
          dataset_id,
          unit_id,
          position,
          is_primary
        ) values (
          '10000000-0000-4000-8000-000000000104',
          '${ids.dataset}', '${ids.units[0]}', 1, true
        );
        insert into public.assignment_students (
          assignment_id,
          student_id,
          assigned_by,
          assigned_at
        ) values (
          '10000000-0000-4000-8000-000000000104',
          '${ids.student}', '${ids.admin}', '2026-08-20T00:00:00Z'
        );
        insert into public.quiz_attempts (
          id,
          student_id,
          assignment_id,
          attempt_number,
          status,
          phase,
          started_at,
          deadline_at,
          completed_at,
          question_count_snapshot,
          time_limit_seconds_snapshot,
          passing_score_snapshot,
          passing_basis_snapshot,
          initial_correct_count,
          retry_correct_count,
          unresolved_wrong_count,
          initial_score,
          final_score,
          passed,
          elapsed_seconds
        ) values (
          '20000000-0000-4000-8000-000000000104',
          '${ids.student}',
          '10000000-0000-4000-8000-000000000104',
          1, 'completed', 'completed',
          '2026-08-20T00:00:00Z', '2026-09-01T00:00:00Z',
          '2026-08-21T00:00:00Z',
          1, 60, 80, 'initial', 1, 0, 0, 100, 100, true, 10
        );
        insert into public.quiz_attempts (
          id,
          student_id,
          assignment_id,
          attempt_number,
          status,
          phase,
          started_at,
          deadline_at,
          question_count_snapshot,
          time_limit_seconds_snapshot,
          passing_score_snapshot,
          passing_basis_snapshot
        ) values (
          '20000000-0000-4000-8000-000000000105',
          '${ids.student}',
          '10000000-0000-4000-8000-000000000104',
          2, 'in_progress', 'initial',
          '2026-08-22T00:00:00Z', '2026-09-01T00:00:00Z',
          1, 60, 80, 'initial'
        );
        insert into public.admin_history_hidden_entries (
          assignment_id,
          student_id,
          attempt_id,
          hidden_by,
          hidden_at
        ) values (
          '10000000-0000-4000-8000-000000000104',
          '${ids.student}',
          '20000000-0000-4000-8000-000000000105',
          '${ids.admin}',
          '2026-08-24T00:00:00Z'
        );
        set role authenticated;
      `);
      const initialPhase = await database.query<{
        group_key: string;
        total_count: number | bigint;
      }>(`
        select group_key, total_count
        from public.get_admin_history_initial_v1(
          'R3 phase initial', 'all', false,
          '2026-08-22T00:00:00Z', 11
        )
      `);
      const retryPhase = await database.query<{
        group_key: string;
        total_count: number | bigint;
      }>(`
        select group_key, total_count
        from public.get_admin_history_initial_v1(
          'R3 phase retry', 'all', false,
          '2026-08-22T00:00:00Z', 11
        )
      `);
      const countFor = (
        rows: Array<{ group_key: string; total_count: number | bigint }>,
        groupKey: string,
      ) => Number(rows.find((row) => row.group_key === groupKey)?.total_count);
      expect(countFor(initialPhase.rows, "open")).toBe(1);
      expect(countFor(initialPhase.rows, "needs_attention")).toBe(0);
      expect(countFor(retryPhase.rows, "open")).toBe(0);
      expect(countFor(retryPhase.rows, "needs_attention")).toBe(1);

      const expiredAtSnapshot = await database.query<{
        items: Array<{ item: { status: string } }>;
        total_count: number | bigint;
      }>(`
        select items, total_count
        from public.get_admin_history_initial_v1(
          'R3 expired snapshot', 'all', false,
          '2026-08-23T00:00:00Z', 11
        )
        where group_key = 'needs_attention'
      `);
      expect(Number(expiredAtSnapshot.rows[0]?.total_count)).toBe(1);
      expect(expiredAtSnapshot.rows[0]?.items[0]?.item.status).toBe("expired");

      const visibleBeforeHidden = await database.query<{
        items: Array<{ item: { attemptId: string } }>;
        total_count: number | bigint;
      }>(`
        select items, total_count
        from public.get_admin_history_initial_v1(
          'R3 hidden snapshot', 'all', true,
          '2026-08-23T00:00:00Z', 11
        )
        where group_key = 'open'
      `);
      expect(Number(visibleBeforeHidden.rows[0]?.total_count)).toBe(1);
      expect(visibleBeforeHidden.rows[0]?.items[0]?.item.attemptId).toBe(
        "20000000-0000-4000-8000-000000000105",
      );

      const previousVisibleAfterHidden = await database.query<{
        items: Array<{ item: { attemptId: string } }>;
        total_count: number | bigint;
      }>(`
        select items, total_count
        from public.get_admin_history_initial_v1(
          'R3 hidden snapshot', 'all', true,
          '2026-08-25T00:00:00Z', 11
        )
        where group_key = 'completed'
      `);
      expect(Number(previousVisibleAfterHidden.rows[0]?.total_count)).toBe(1);
      expect(previousVisibleAfterHidden.rows[0]?.items[0]?.item.attemptId).toBe(
        "20000000-0000-4000-8000-000000000104",
      );

      const privileges = await database.query<{
        anon_helper: boolean;
        anon_initial: boolean;
        anon_page: boolean;
        anon_detail: boolean;
        authenticated_helper: boolean;
        authenticated_initial: boolean;
        authenticated_page: boolean;
        authenticated_detail: boolean;
        service_helper: boolean;
        service_initial: boolean;
        service_page: boolean;
        service_detail: boolean;
      }>(`
        select
          has_function_privilege(
            'anon',
            'private.admin_history_read_rows_v1(timestamptz,uuid,uuid,uuid,text)',
            'execute'
          ) as anon_helper,
          has_function_privilege(
            'service_role',
            'private.admin_history_read_rows_v1(timestamptz,uuid,uuid,uuid,text)',
            'execute'
          ) as service_helper,
          has_function_privilege(
            'authenticated',
            'private.admin_history_read_rows_v1(timestamptz,uuid,uuid,uuid,text)',
            'execute'
          ) as authenticated_helper,
          has_function_privilege(
            'anon',
            'public.get_admin_history_initial_v1(text,text,boolean,timestamptz,integer)',
            'execute'
          ) as anon_initial,
          has_function_privilege(
            'service_role',
            'public.get_admin_history_initial_v1(text,text,boolean,timestamptz,integer)',
            'execute'
          ) as service_initial,
          has_function_privilege(
            'authenticated',
            'public.get_admin_history_initial_v1(text,text,boolean,timestamptz,integer)',
            'execute'
          ) as authenticated_initial,
          has_function_privilege(
            'anon',
            'public.list_admin_history_page_v1(text,text,boolean,text,timestamptz,timestamptz,text,integer)',
            'execute'
          ) as anon_page,
          has_function_privilege(
            'service_role',
            'public.list_admin_history_page_v1(text,text,boolean,text,timestamptz,timestamptz,text,integer)',
            'execute'
          ) as service_page,
          has_function_privilege(
            'authenticated',
            'public.list_admin_history_page_v1(text,text,boolean,text,timestamptz,timestamptz,text,integer)',
            'execute'
          ) as authenticated_page,
          has_function_privilege(
            'anon',
            'public.get_admin_history_detail_v1(uuid,uuid,uuid)',
            'execute'
          ) as anon_detail,
          has_function_privilege(
            'service_role',
            'public.get_admin_history_detail_v1(uuid,uuid,uuid)',
            'execute'
          ) as service_detail,
          has_function_privilege(
            'authenticated',
            'public.get_admin_history_detail_v1(uuid,uuid,uuid)',
            'execute'
          ) as authenticated_detail
      `);
      expect(privileges.rows[0]).toEqual({
        anon_helper: false,
        anon_initial: false,
        anon_page: false,
        anon_detail: false,
        authenticated_helper: true,
        authenticated_initial: true,
        authenticated_page: true,
        authenticated_detail: true,
        service_helper: false,
        service_initial: false,
        service_page: false,
        service_detail: false,
      });

      await database.exec(`
        reset role;
        select set_config(
          'request.jwt.claim.sub',
          '${ids.student}',
          false
        );
        set role authenticated;
      `);
      await expectPostgresError(
        database.query(`
          select *
          from public.get_admin_history_initial_v1('', 'all', false, null, 11)
        `),
        "42501",
        "forbidden",
      );
      const privateRows = await database.query<{ count: number }>(`
        select count(*)::integer as count
        from private.admin_history_read_rows_v1(clock_timestamp())
      `);
      expect(privateRows.rows).toEqual([{ count: 0 }]);
    } finally {
      await database.close();
    }
  }, 60_000);
});
