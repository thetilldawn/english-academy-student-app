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

async function createFinalSchemaDatabase() {
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
  `);

  for (const migrationPath of migrationPaths) {
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
      authenticated_public_identity_v1: boolean;
      authenticated_public_review_summary: boolean;
      authenticated_replace_v2: boolean;
      authenticated_replace_v3: boolean;
      authenticated_replace_v4: boolean;
      authenticated_replace_v1: boolean;
      service_replace_v1: boolean;
      authenticated_replacement_ledger_select: boolean;
      anon_public_mixed: boolean;
      anon_public_exact: boolean;
      anon_public_review_summary: boolean;
      anon_replace_v2: boolean;
      anon_public_mixed_v9: boolean;
      anon_public_bulk_v4: boolean;
      anon_replace_v4: boolean;
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
          'public.replace_student_assignment_v4(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)',
          'execute'
        ) as anon_replace_v4;
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
      authenticated_public_bulk_v3: true,
      authenticated_public_bulk_v4: true,
      authenticated_public_identity_v1: true,
      authenticated_public_review_summary: true,
      authenticated_replace_v2: false,
      authenticated_replace_v3: true,
      authenticated_replace_v4: true,
      authenticated_replace_v1: false,
      service_replace_v1: false,
      authenticated_replacement_ledger_select: false,
      anon_public_mixed: false,
      anon_public_exact: false,
      anon_public_review_summary: false,
      anon_replace_v2: false,
      anon_public_mixed_v9: false,
      anon_public_bulk_v4: false,
      anon_replace_v4: false,
    });
  });

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
        "assignment_unit_range_not_contiguous",
      );
    } finally {
      await rangeDatabase.close();
    }
  }, 30_000);

  it("keeps the deployment-window compatibility rollback executable", async () => {
    const rollbackDatabase = await createFinalSchemaDatabase();
    try {
      await rollbackDatabase.exec(lifecycleRollbackSql);
      const privileges = await rollbackDatabase.query<{
        legacy_mixed: boolean;
        current_mixed: boolean;
        legacy_regular: boolean;
        current_regular: boolean;
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
          ) as current_regular;
      `);
      expect(privileges.rows[0]).toEqual({
        legacy_mixed: true,
        current_mixed: false,
        legacy_regular: true,
        current_regular: false,
      });
    } finally {
      await rollbackDatabase.close();
    }
  });

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

  it("creates regular assignments atomically and shares the all-word duplicate guard", async () => {
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
        "assignment_word_already_active",
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

  it("blocks duplicate active headwords even before dictionary linking", async () => {
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
          array['fixture-' || entry_id],
          'fixture-' || entry_id,
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
        [6, 8, 9, 10].map((vocabEntryId, index) => ({
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
      await expectPostgresError(
        createAssignment(
          "Unlinked headword duplicate",
          secondQuestions,
        ),
        "40001",
        "assignment_word_already_active",
      );
      await unlinkedDatabase.query(`
        select public.cancel_student_assignment_v1(
          '${first.rows[0]?.assignment_id}',
          '${ids.student}',
          'unlinked duplicate guard verification'
        );
      `);
      const reassigned = await createAssignment(
        "Unlinked headword after cancellation",
        secondQuestions,
      );
      await unlinkedDatabase.exec("reset role;");

      expect(reassigned.rows[0]?.assignment_id).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
      const attempt = await unlinkedDatabase.query<{
        attempt_id: string;
      }>(`
        select public.create_quiz_attempt_from_bank(
          '${ids.student}',
          '${reassigned.rows[0]?.assignment_id}'
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
        select public.delete_assignment_v1(
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
          select public.delete_assignment_v1(
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

  it("preserves mixed targets for metadata edits and rolls the full lifecycle back on failure", async () => {
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

      const replacement = await mixedReplacementDatabase.query<{
        result: {
          replacementAssignmentId: string;
          replacementPurpose: string;
        };
      }>(`
        select public.replace_student_assignment_v3(
          '${sourceAssignmentId}', '${ids.student}', '${replacementKey}',
          repeat('b', 64), 'mixed', 'preserve', 'Mixed renamed',
          '${ids.dataset}', array['${ids.units[4]}'::uuid], 4,
          100::smallint, 600, 80::smallint, 'fixed', null,
          'total', null, array[1]::smallint[],
          array['${ids.selectedQueue}'::uuid],
          $questions$${mixedQuestions}$questions$::jsonb
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
        JSON.parse(mixedQuestions).map(
          (question: Record<string, unknown>) => ({
            ...question,
            base_order_index: 1,
          }),
        ),
      );
      await mixedReplacementDatabase.exec("set role authenticated;");
      await expectPostgresError(
        mixedReplacementDatabase.query(`
          select public.replace_student_assignment_v3(
            '${replacementAssignmentId}', '${ids.student}', '${rollbackKey}',
            repeat('c', 64), 'mixed', 'recalculate', 'Must roll back',
            '${ids.dataset}', array['${ids.units[4]}'::uuid], 4,
            100::smallint, 600, 80::smallint, 'fixed', null,
            'total', null, array[1]::smallint[],
            array['${ids.selectedQueue}'::uuid],
            $questions$${invalidQuestions}$questions$::jsonb
          );
        `),
        "22023",
        "invalid_review_question_plan",
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
      const allReview = await mixedReplacementDatabase.query<{
        result: {
          replacementAssignmentId: string;
          replacementPurpose: string;
        };
      }>(`
        select public.replace_student_assignment_v3(
          '${replacementAssignmentId}', '${ids.student}', '${allReviewKey}',
          repeat('e', 64), 'mixed', 'recalculate', 'Only wrong word',
          '${ids.dataset}', array['${ids.units[4]}'::uuid], 1,
          100::smallint, 600, 80::smallint, 'fixed', null,
          'total', null, array[1]::smallint[],
          array['${ids.selectedQueue}'::uuid],
          $questions$${oneReviewQuestion}$questions$::jsonb
        ) as result;
      `);
      await mixedReplacementDatabase.exec("reset role;");
      expect(allReview.rows[0]!.result.replacementPurpose).toBe(
        "review",
      );
      const allReviewState = await mixedReplacementDatabase.query<{
        question_count: number;
        primary_units: number;
        active_targets: number;
      }>(`
        select
          assignment.question_count,
          (
            select count(*)::integer from public.assignment_units
            where assignment_id = assignment.id and is_primary
          ) as primary_units,
          (
            select count(*)::integer from public.assignment_review_targets
            where assignment_id = assignment.id and released_at is null
          ) as active_targets
        from public.assignments as assignment
        where assignment.id = '${allReview.rows[0]!.result.replacementAssignmentId}';
      `);
      expect(allReviewState.rows[0]).toEqual({
        question_count: 1,
        primary_units: 0,
        active_targets: 1,
      });
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
        const draftId = `00000000-0000-4000-8000-00000000042${targetCount}`;
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

        await exactReplacementDatabase.exec(`
          insert into public.student_vocab_review_assignment_drafts (
            id, student_id, dataset_id, status, created_by, expires_at
          )
          values (
            '${draftId}', '${ids.student}', '${ids.dataset}', 'pending',
            '${ids.admin}', clock_timestamp() + interval '1 hour'
          );

          update public.student_vocab_review_queue
          set
            reserved_review_draft_id = '${draftId}',
            reserved_at = clock_timestamp()
          where id = any(array[${queueSql}]::uuid[]);

          insert into public.student_vocab_review_assignment_draft_items (
            draft_id, queue_id, position
          )
          select '${draftId}', selected.queue_id, selected.position::integer
          from unnest(array[${queueSql}]::uuid[]) with ordinality
            as selected(queue_id, position);
        `);

        const source = await exactReplacementDatabase.query<{
          assignment_id: string;
        }>(`
          select private.create_exact_review_assignment_v4(
            '${draftId}', 'Exact source ${targetCount}', 100::smallint,
            600, 80::smallint, 'fixed', null,
            $questions$${questions}$questions$::jsonb
          ) as assignment_id;
        `);
        const sourceAssignmentId = source.rows[0]!.assignment_id;

        await exactReplacementDatabase.exec(`
          insert into public.assignment_review_targets (
            assignment_id,
            student_id,
            review_queue_id,
            assignment_question_id,
            dataset_id,
            vocab_entry_id,
            canonical_lexeme_id_snapshot
          )
          select
            '${sourceAssignmentId}',
            '${ids.student}',
            queue.id,
            question.id,
            queue.dataset_id,
            queue.vocab_entry_id,
            queue.canonical_lexeme_id_snapshot
          from unnest(array[${queueSql}]::uuid[]) with ordinality
            as selected(queue_id, position)
          join public.student_vocab_review_queue as queue
            on queue.id = selected.queue_id
          join public.assignment_questions as question
            on question.assignment_id = '${sourceAssignmentId}'
            and question.vocab_entry_id = queue.vocab_entry_id
          order by selected.position;

          update public.student_vocab_review_queue
          set
            status = 'pending',
            consumed_assignment_id = null,
            consumed_at = null
          where id = any(array[${queueSql}]::uuid[])
            and consumed_assignment_id = '${sourceAssignmentId}';

          select private.link_pending_review_targets_v1(
            '${sourceAssignmentId}',
            array['${ids.student}'::uuid]
          );
          select private.configure_assignment_delivery_v1(
            '${sourceAssignmentId}',
            'total',
            null
          );
        `);

        await exactReplacementDatabase.exec("set role authenticated;");
        const replacement = await exactReplacementDatabase.query<{
          result: {
            replacementAssignmentId: string;
            replacementPurpose: string;
          };
        }>(`
          select public.replace_student_assignment_v3(
            '${sourceAssignmentId}', '${ids.student}', '${replacementKey}',
            repeat('d', 64), 'review', 'preserve',
            'Exact replacement ${targetCount}', '${ids.dataset}',
            array[]::uuid[], ${targetCount}, 100::smallint, 600,
            80::smallint, 'fixed', null, 'total', null,
            array[1]::smallint[], array[${queueSql}]::uuid[],
            $questions$${questions}$questions$::jsonb
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
        select public.replace_student_assignment_v3(
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
        select public.replace_student_assignment_v3(
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
          select public.replace_student_assignment_v3(
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
          select public.replace_student_assignment_v3(
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
