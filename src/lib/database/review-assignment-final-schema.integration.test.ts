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
    create schema extensions;
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
    await database.exec(fs.readFileSync(migrationPath, "utf8"));
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
        correct_choice_index
      )
      select
        created_assignment_id,
        question.vocab_entry_id,
        question.base_order_index,
        question.direction::public.question_direction,
        'prompt-' || question.vocab_entry_id,
        jsonb_build_array('A', 'B', 'C', 'D'),
        0
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
    await database.close();
  });

  it("applies every migration and exposes only the intended mixed RPC", async () => {
    const signatures = await database.query<{
      private_core: string | null;
      public_mixed: string | null;
      exact_v4: string | null;
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
        )::text as exact_v4;
    `);

    expect(signatures.rows[0]?.private_core).not.toBeNull();
    expect(signatures.rows[0]?.public_mixed).not.toBeNull();
    expect(signatures.rows[0]?.exact_v4).not.toBeNull();

    const privileges = await database.query<{
      authenticated_core: boolean;
      authenticated_private_mixed: boolean;
      authenticated_public_mixed: boolean;
      authenticated_public_exact: boolean;
      anon_public_mixed: boolean;
      anon_public_exact: boolean;
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
          'anon',
          'public.create_mixed_review_assignment_v5(uuid,uuid,smallint[],integer,uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)',
          'execute'
        ) as anon_public_mixed,
        has_function_privilege(
          'anon',
          'public.create_exact_review_assignment_v4(uuid,text,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)',
          'execute'
        ) as anon_public_exact;
    `);

    expect(privileges.rows[0]).toEqual({
      authenticated_core: false,
      authenticated_private_mixed: true,
      authenticated_public_mixed: true,
      authenticated_public_exact: true,
      anon_public_mixed: false,
      anon_public_exact: false,
    });
  });

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
      "22023",
      "mixed_regular_target_already_pending_review",
    );
    await database.exec("reset role;");

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
});
