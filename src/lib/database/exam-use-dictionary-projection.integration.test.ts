import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  computeExamUseEntryContentHash,
  computeExamUsePackageVersion,
  validateExamUsePackage,
} from "@/lib/vocab/exam-use-import-contract";

const migrationsDirectory = path.resolve("supabase/migrations");
const migrationPaths = fs
  .readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => path.join(migrationsDirectory, name));

const ids = {
  admin: "00000000-0000-4000-8000-000000009001",
  student: "00000000-0000-4000-8000-000000009002",
} as const;

function buildEntry(sourceRow: number) {
  const suffix = String(sourceRow).padStart(12, "0");
  const entry: Record<string, unknown> = {
    source_row: sourceRow,
    sequence_no: sourceRow,
    unit: "2025-01 장문독해",
    day: null,
    position_in_unit: sourceRow,
    dictionary_id: `word:integration-${sourceRow}`,
    legacy_ids: [
      {
        system: "legacy-word-index",
        id: `00000000-0000-4000-8000-${suffix}`,
      },
    ],
    sense_id: null,
    pronunciation_variant_id: `mw:integration-${sourceRow}`,
    display_headword: `integration${sourceRow}`,
    display_gloss_ko: `통합 ${sourceRow}`,
    display_pronunciation_ko: `인티그레이션 ${sourceRow}`,
    display_pronunciation_review_status: "candidate",
    audio: {
      status: "raw_attached",
      audio_url:
        `https://media.merriam-webster.com/audio/prons/en/us/mp3/i/integration${sourceRow}.mp3`,
      sound_audio: `integration${sourceRow}`,
      raw_response_sha256: "a".repeat(64),
      raw_source: "api_raw",
      raw_relative_path: `pron-integration-${sourceRow}.json`,
      reason: null,
      selection_status: "single_exact_raw_variant",
      source_locator: `meta.id=integration${sourceRow} hwi.prs[0]`,
      variant_id: `mw:integration-${sourceRow}`,
      variant_pos: "noun",
      mw_notation: `in-te-gra-tion-${sourceRow}`,
    },
    occurrence_id: `occ:integration-${sourceRow}`,
    occurrence_content_hash: sourceRow.toString(16).padStart(64, "b"),
    content_hash: "0".repeat(64),
    exam_review_id: `exam-review:integration-${sourceRow}`,
    exam_input_hash: sourceRow.toString(16).padStart(64, "c"),
    exam_use_status: "reviewed_for_preview",
    context_evidence_status: "source_entry_context",
    context_evidence: {
      source: "source_entries",
      source_entry_id: `entry-integration-${sourceRow}`,
      source_entry_sha256: sourceRow.toString(16).padStart(64, "d"),
    },
    entry_row_sha256: sourceRow
      .toString(16)
      .toUpperCase()
      .padStart(64, "E"),
    source_entry_id: `entry-integration-${sourceRow}`,
    source_entry_sha256: sourceRow.toString(16).padStart(64, "d"),
    include_in_exam: true,
    manual_review_flags: [],
  };
  entry.content_hash = computeExamUseEntryContentHash(entry);
  return entry;
}

function buildPackage() {
  const input: Record<string, unknown> = {
    schema_version: "1.0",
    package_type: "student-app-exam-use-wordbook",
    target_environment: "preview",
    common_dictionary_release_allowed: false,
    exam_use_import_allowed: true,
    package_version: "0".repeat(64),
    dataset_key: "integration-exam-use-v1",
    source_sha256: "1".repeat(64),
    candidate_dictionary_version: "2".repeat(64),
    manifest_content_hash: "3".repeat(64),
    exam_review_ledger_sha256: "4".repeat(64),
    wordbook_id: "integration-wordbook",
    title: "통합 테스트용 가짜 단어장",
    generated_at_utc: "2026-08-07T00:00:00Z",
    entries: [1, 2, 3, 4].map(buildEntry),
  };
  input.package_version = computeExamUsePackageVersion(input);
  validateExamUsePackage(input);
  return input;
}

function buildRepeatedOccurrencePackage() {
  const packageEntries = [101, 102, 103, 104, 105].map(buildEntry);
  packageEntries[1] = {
    ...packageEntries[1],
    dictionary_id: packageEntries[0]!.dictionary_id,
    display_headword: packageEntries[0]!.display_headword,
    display_gloss_ko: packageEntries[0]!.display_gloss_ko,
  };
  packageEntries[1]!.content_hash = computeExamUseEntryContentHash(
    packageEntries[1]!,
  );
  const input: Record<string, unknown> = {
    schema_version: "1.0",
    package_type: "student-app-exam-use-wordbook",
    target_environment: "preview",
    common_dictionary_release_allowed: false,
    exam_use_import_allowed: true,
    package_version: "0".repeat(64),
    dataset_key: "integration-repeated-occurrence-v1",
    source_sha256: "5".repeat(64),
    candidate_dictionary_version: "6".repeat(64),
    manifest_content_hash: "7".repeat(64),
    exam_review_ledger_sha256: "8".repeat(64),
    wordbook_id: "integration-repeated-occurrence",
    title: "중복 occurrence 통합 테스트 단어장",
    generated_at_utc: "2026-08-10T00:00:00Z",
    entries: packageEntries,
  };
  input.package_version = computeExamUsePackageVersion(input);
  validateExamUsePackage(input);
  return input;
}

async function createFinalSchemaDatabase() {
  const database = new PGlite({ extensions: { pgcrypto } });
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
    ) returns bigint language plpgsql as $$
    declare scheduled_job_id bigint;
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
    create table auth.users (id uuid primary key);
    create function auth.uid()
    returns uuid language sql stable set search_path = '' as $$
      select nullif(
        current_setting('request.jwt.claim.sub', true),
        ''
      )::uuid;
    $$;
    create function auth.role()
    returns text language sql stable set search_path = '' as $$
      select nullif(
        current_setting('request.jwt.claim.role', true),
        ''
      );
    $$;
    create function auth.jwt()
    returns jsonb language sql stable set search_path = '' as $$
      select coalesce(
        nullif(current_setting('request.jwt.claims', true), ''),
        '{}'
      )::jsonb;
    $$;
  `);
  for (const migrationPath of migrationPaths) {
    const migration = fs
      .readFileSync(migrationPath, "utf8")
      .replace("create extension if not exists pg_cron;", "");
    try {
      await database.exec(migration);
    } catch (error) {
      throw new Error(
        `migration failed: ${path.basename(migrationPath)}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  return database;
}

describe.sequential("exam-use dictionary projection", () => {
  let database: PGlite;
  let datasetId = "";
  let releaseId = "";
  let unitId = "";
  let entryIds: number[] = [];
  let assignmentId = "";
  let attemptId = "";
  let exactQueueIds: string[] = [];
  let dictionaryExactAssignmentId = "";

  beforeAll(async () => {
    database = await createFinalSchemaDatabase();
  }, 30_000);

  afterAll(async () => {
    await database?.close();
  });

  afterEach(async () => {
    await database?.exec("reset role;");
  });

  it("service role만 같은 패키지를 원자적·멱등적으로 가져온다", async () => {
    const packageJson = JSON.stringify(buildPackage());
    await database.exec(`
      set role service_role;
      select set_config('request.jwt.claim.role', 'service_role', false);
      select set_config('request.jwt.claims', '{"role":"service_role"}', false);
    `);
    const first = await database.query<{
      result: {
        datasetId: string;
        releaseId: string;
        idempotent: boolean;
        occurrenceCount: number;
        includedCount: number;
      };
    }>(
      "select public.import_app_exam_use_package_v1($1::jsonb) as result",
      [packageJson],
    );
    const second = await database.query<{
      result: {
        datasetId: string;
        releaseId: string;
        idempotent: boolean;
        occurrenceCount: number;
        includedCount: number;
        dictionaryCount: number;
      };
    }>(
      "select public.import_app_exam_use_package_v1($1::jsonb) as result",
      [packageJson],
    );
    await database.exec(`
      reset role;
      select set_config('request.jwt.claim.role', 'authenticated', false);
      select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
    `);

    datasetId = first.rows[0]!.result.datasetId;
    releaseId = first.rows[0]!.result.releaseId;
    expect(first.rows[0]!.result).toMatchObject({
      idempotent: false,
      occurrenceCount: 4,
      includedCount: 4,
    });
    expect(second.rows[0]!.result).toEqual({
      datasetId,
      releaseId,
      status: "active",
      idempotent: true,
      occurrenceCount: 4,
      includedCount: 4,
      dictionaryCount: 4,
    });

    const state = await database.query<{
      unit_id: string;
      release_count: number;
      occurrence_count: number;
      entry_count: number;
      eligibility_count: number;
      projection_count: number;
    }>(`
      select
        min(unit.id::text) as unit_id,
        (select count(*)::integer
          from word_index.app_exam_use_release) as release_count,
        (select count(*)::integer
          from word_index.app_exam_use_occurrence) as occurrence_count,
        (select count(*)::integer
          from public.vocab_entries
          where dataset_id = '${datasetId}') as entry_count,
        (select count(*)::integer
          from public.vocab_entry_quiz_eligibility
          where dataset_id = '${datasetId}') as eligibility_count,
        (select count(*)::integer
          from word_index.app_exam_use_occurrence
          where dataset_id = '${datasetId}'
            and include_in_exam) as projection_count
      from public.vocab_units as unit
      where unit.dataset_id = '${datasetId}'
      group by unit.dataset_id;
    `);
    unitId = state.rows[0]!.unit_id;
    expect(state.rows[0]).toMatchObject({
      release_count: 1,
      occurrence_count: 4,
      entry_count: 4,
      eligibility_count: 0,
      projection_count: 4,
    });

    const entries = await database.query<{ id: number }>(`
      select id
      from public.vocab_entries
      where dataset_id = '${datasetId}'
      order by source_row;
    `);
    entryIds = entries.rows.map((entry) => entry.id);
  });

  it("서버가 문항·발음 snapshot을 다시 만들고 학생 시험을 시작한다", async () => {
    await database.exec(`
      select set_config('request.jwt.claim.sub', '${ids.admin}', false);
      select set_config('request.jwt.claim.role', 'authenticated', false);
      select set_config(
        'request.jwt.claims',
        '{"role":"authenticated"}',
        false
      );
      insert into auth.users (id) values ('${ids.admin}');
      insert into public.admin_profiles (user_id, display_name, is_active)
      values ('${ids.admin}', 'Preview admin', true);
      insert into public.students (id, display_name, status, created_by)
      values ('${ids.student}', 'Preview student', 'active', '${ids.admin}');
    `);

    const directions = [
      "english_to_korean",
      "english_to_korean",
      "korean_to_english",
      "korean_to_english",
    ];
    const questions = entryIds.map((entryId, index) => ({
      vocab_entry_id: entryId,
      base_order_index: index + 1,
      direction: directions[index],
      choice_vocab_entry_ids: entryIds,
    }));

    await database.exec("set role authenticated;");
    const eligibility = await database.query<{
      vocab_entry_id: number;
      canonical_dictionary_id: string;
    }>(
      `select vocab_entry_id, canonical_dictionary_id
       from public.list_active_exam_use_eligibility_v1($1::uuid)`,
      [datasetId],
    );
    expect(eligibility.rows).toHaveLength(8);
    expect(new Set(
      eligibility.rows.map((row) => row.canonical_dictionary_id),
    ).size).toBe(4);

    const assignment = await database.query<{ id: string }>(
      `select public.create_assignment_with_delivery_v6(
        $1, $2::uuid, array[$3::uuid], 4, 50::smallint, 60,
        80::smallint,
        'fixed'::public.question_order_mode,
        clock_timestamp() + interval '1 day',
        array[$4::uuid], 'per_question', 5, $5::jsonb
      ) as id`,
      [
        "Preview dictionary integration",
        datasetId,
        unitId,
        ids.student,
        JSON.stringify(questions),
      ],
    );
    await database.exec("reset role;");
    assignmentId = assignment.rows[0]!.id;

    const assignmentState = await database.query<{
      status: string;
      provenance_status: string;
      question_bank_version: number;
      timing_mode: string;
      question_time_limit_seconds: number;
      question_count: number;
      snapshot_count: number;
      release_snapshot_count: number;
    }>(`
      select
        assignment.status::text,
        assignment.provenance_status,
        assignment.question_bank_version,
        assignment.timing_mode,
        assignment.question_time_limit_seconds,
        (select count(*)::integer
          from public.assignment_questions as question
          where question.assignment_id = assignment.id) as question_count,
        (select count(*)::integer
          from public.assignment_question_exam_use_snapshot as snapshot
          where snapshot.assignment_id = assignment.id
            and snapshot.provenance_status = 'reviewed_for_preview_v1'
            and snapshot.release_id = '${releaseId}'
            and snapshot.pronunciation_snapshot ->> 'audioStatus'
              = 'raw_attached'
            and jsonb_array_length(
              snapshot.choice_dictionary_snapshots
            ) = 4) as snapshot_count,
        (select count(*)::integer
          from word_index.assignment_exam_use_release_snapshot as snapshot
          where snapshot.assignment_id = assignment.id
            and snapshot.release_id = '${releaseId}')
          as release_snapshot_count
      from public.assignments as assignment
      where assignment.id = '${assignmentId}';
    `);
    expect(assignmentState.rows[0]).toEqual({
      status: "active",
      provenance_status: "legacy_backfill",
      question_bank_version: 1,
      timing_mode: "per_question",
      question_time_limit_seconds: 5,
      question_count: 4,
      snapshot_count: 4,
      release_snapshot_count: 1,
    });

    const attempt = await database.query<{ id: string }>(`
      select public.create_quiz_attempt_from_bank(
        '${ids.student}',
        '${assignmentId}'
      ) as id;
    `);
    attemptId = attempt.rows[0]!.id;
    const attemptState = await database.query<{
      status: string;
      phase: string;
      question_count: number;
      snapshot_join_count: number;
    }>(`
      select
        attempt.status::text,
        attempt.phase::text,
        (select count(*)::integer
          from public.quiz_questions as question
          where question.attempt_id = attempt.id) as question_count,
        (select count(*)::integer
          from public.quiz_questions as question
          join public.assignment_questions as bank
            on bank.id = question.assignment_question_id
          join public.assignment_question_exam_use_snapshot as snapshot
            on snapshot.assignment_question_id = bank.id
          where question.attempt_id = attempt.id
            and bank.provenance_status = 'legacy_backfill'
            and snapshot.provenance_status = 'reviewed_for_preview_v1'
            and snapshot.pronunciation_snapshot is not null)
          as snapshot_join_count
      from public.quiz_attempts as attempt
      where attempt.id = '${attempt.rows[0]!.id}';
    `);
    expect(attemptState.rows[0]).toEqual({
      status: "in_progress",
      phase: "initial",
      question_count: 4,
      snapshot_join_count: 4,
    });
  });

  it("stores separate source occurrences that share one dictionary identity", async () => {
    await database.exec(`
      set role service_role;
      select set_config('request.jwt.claim.role', 'service_role', false);
      select set_config('request.jwt.claims', '{"role":"service_role"}', false);
    `);
    const imported = await database.query<{
      result: { datasetId: string; releaseId: string };
    }>(
      "select public.import_app_exam_use_package_v1($1::jsonb) as result",
      [JSON.stringify(buildRepeatedOccurrencePackage())],
    );
    await database.exec(`
      reset role;
      select set_config('request.jwt.claim.role', 'authenticated', false);
      select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
    `);

    const repeatedDatasetId = imported.rows[0]!.result.datasetId;
    const repeatedReleaseId = imported.rows[0]!.result.releaseId;
    const source = await database.query<{
      vocab_entry_id: number;
      unit_id: string;
      dictionary_id: string;
    }>(`
      select
        occurrence.vocab_entry_id,
        occurrence.unit_id,
        occurrence.dictionary_id
      from word_index.app_exam_use_occurrence as occurrence
      where occurrence.release_id = '${repeatedReleaseId}'
      order by occurrence.source_row;
    `);
    expect(source.rows).toHaveLength(5);
    expect(source.rows[0]?.dictionary_id).toBe(
      source.rows[1]?.dictionary_id,
    );
    const repeatedEntryIds = source.rows.map((row) => row.vocab_entry_id);
    const commonChoices = [
      repeatedEntryIds[0],
      repeatedEntryIds[2],
      repeatedEntryIds[3],
      repeatedEntryIds[4],
    ];
    const questionPlan = [
      {
        vocab_entry_id: repeatedEntryIds[0],
        base_order_index: 1,
        direction: "english_to_korean",
        choice_vocab_entry_ids: commonChoices,
      },
      {
        vocab_entry_id: repeatedEntryIds[1],
        base_order_index: 2,
        direction: "english_to_korean",
        choice_vocab_entry_ids: [
          repeatedEntryIds[1],
          repeatedEntryIds[2],
          repeatedEntryIds[3],
          repeatedEntryIds[4],
        ],
      },
      {
        vocab_entry_id: repeatedEntryIds[2],
        base_order_index: 3,
        direction: "korean_to_english",
        choice_vocab_entry_ids: commonChoices,
      },
      {
        vocab_entry_id: repeatedEntryIds[3],
        base_order_index: 4,
        direction: "korean_to_english",
        choice_vocab_entry_ids: commonChoices,
      },
    ];

    await database.exec("set role authenticated;");
    const assignment = await database.query<{ id: string }>(
      `select public.create_assignment_with_delivery_v6(
        'Repeated occurrence assignment',
        $1::uuid,
        array[$2::uuid],
        4,
        50::smallint,
        60,
        80::smallint,
        'fixed'::public.question_order_mode,
        clock_timestamp() + interval '1 day',
        array[$3::uuid],
        'total',
        null,
        $4::jsonb
      ) as id`,
      [
        repeatedDatasetId,
        source.rows[0]!.unit_id,
        ids.student,
        JSON.stringify(questionPlan),
      ],
    );
    await database.exec("reset role;");

    const state = await database.query<{
      question_count: number;
      snapshot_count: number;
      distinct_dictionary_count: number;
    }>(`
      select
        count(*)::integer as question_count,
        count(snapshot.assignment_question_id)::integer as snapshot_count,
        count(distinct snapshot.dictionary_id)::integer
          as distinct_dictionary_count
      from public.assignment_questions as question
      join public.assignment_question_exam_use_snapshot as snapshot
        on snapshot.assignment_question_id = question.id
      where question.assignment_id = '${assignment.rows[0]!.id}';
    `);
    expect(state.rows[0]).toEqual({
      question_count: 4,
      snapshot_count: 4,
      distinct_dictionary_count: 3,
    });
  });

  it("오답 해석 자료 요청을 occurrence 근거와 함께 멱등 저장·내보낸다", async () => {
    const questions = await database.query<{
      id: string;
      correct_choice_index: number;
      vocab_entry_id: number;
    }>(`
      select id, correct_choice_index, vocab_entry_id
      from public.quiz_questions
      where attempt_id = '${attemptId}'
      order by order_index;
    `);

    for (const question of questions.rows) {
      await database.query(
        `select public.answer_quiz_question_v2(
          $1::uuid,
          $2::uuid,
          $3::uuid,
          'initial',
          $4::smallint,
          false
        )`,
        [
          ids.student,
          attemptId,
          question.id,
          (question.correct_choice_index + 1) % 4,
        ],
      );
    }
    await database.query(
      "select public.start_quiz_retry($1::uuid, $2::uuid)",
      [ids.student, attemptId],
    );
    for (const question of questions.rows) {
      await database.query(
        `select public.answer_quiz_question_v2(
          $1::uuid,
          $2::uuid,
          $3::uuid,
          'retry',
          $4::smallint,
          false
        )`,
        [
          ids.student,
          attemptId,
          question.id,
          (question.correct_choice_index + 1) % 4,
        ],
      );
    }

    const selectedIds = questions.rows.slice(0, 2).map((row) => row.id);
    await database.exec("set role authenticated;");
    const first = await database.query<{
      request_id: string;
      item_count: number;
      content_sha256: string;
      reused: boolean;
    }>(
      `select * from public.create_wrong_word_worksheet_request_v1(
        $1::uuid,
        $2::uuid[]
      )`,
      [ids.student, selectedIds],
    );
    expect(first.rows[0]).toMatchObject({
      item_count: 2,
      reused: false,
    });

    await database.exec("reset role;");
    await database.query(
      `update public.student_vocab_state
       set unresolved_wrong_count = unresolved_wrong_count + 1,
           last_wrong_at = clock_timestamp()
       where student_id = $1::uuid
         and vocab_entry_id = $2`,
      [ids.student, questions.rows[0]!.vocab_entry_id],
    );
    await database.exec("set role authenticated;");
    const second = await database.query<{
      request_id: string;
      item_count: number;
      content_sha256: string;
      reused: boolean;
    }>(
      `select * from public.create_wrong_word_worksheet_request_v1(
        $1::uuid,
        $2::uuid[]
      )`,
      [ids.student, [...selectedIds].reverse()],
    );
    expect(second.rows[0]).toEqual({
      ...first.rows[0],
      reused: true,
    });

    const exported = await database.query<{ payload: Record<string, unknown> }>(
      `select public.export_wrong_word_worksheet_request_v1(
        $1::uuid
      ) as payload`,
      [first.rows[0]!.request_id],
    );
    const payload = exported.rows[0]!.payload as {
      request_id: string;
      student_id: string;
      item_count: number;
      items: Array<{
        position: number;
        dictionary_id: string;
        occurrence_id: string;
        generation_status: string;
      }>;
      target_profile: {
        school_name: string | null;
        grade_label: string | null;
      };
    };
    expect(payload).toMatchObject({
      request_id: first.rows[0]!.request_id,
      student_id: ids.student,
      item_count: 2,
    });
    expect(payload.items.map((item) => item.position)).toEqual([1, 2]);
    expect(
      payload.items.every(
        (item) =>
          item.dictionary_id.startsWith("word:") &&
          item.occurrence_id.startsWith("occ:") &&
          item.generation_status === "ready",
      ),
    ).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("Preview student");

    const audit = await database.query<{ event_type: string }>(`
      select event_type
      from public.audit_events
      where details ->> 'requestId' = '${first.rows[0]!.request_id}'
      order by id;
    `);
    expect(audit.rows.map((row) => row.event_type)).toEqual([
      "worksheet.wrong_word.queued",
      "worksheet.wrong_word.exported",
    ]);
    await database.exec("reset role;");
  });

  it("creates an exact four-word review assignment from dictionary snapshots", async () => {
    const sourceQuestions = await database.query<{
      id: string;
      vocab_entry_id: number;
    }>(`
      select id, vocab_entry_id
      from public.quiz_questions
      where attempt_id = '${attemptId}'
      order by order_index;
    `);
    const questionIds = sourceQuestions.rows.map((row) => row.id);

    await database.exec("set role authenticated;");
    const queued = await database.query<{ queue_ids: string[] }>(
      `select public.queue_student_vocab_review_words(
        $1::uuid,
        $2::uuid[]
      ) as queue_ids`,
      [ids.student, questionIds],
    );
    await database.exec("reset role;");

    const queueIds = queued.rows[0]!.queue_ids;
    exactQueueIds = queueIds;
    expect(queueIds).toHaveLength(4);
    const queueEntries = await database.query<{
      id: string;
      vocab_entry_id: number;
      canonical_dictionary_id_snapshot: string;
    }>(
      `select
        queue.id,
        queue.vocab_entry_id,
        queue.canonical_dictionary_id_snapshot
       from public.student_vocab_review_queue as queue
       where queue.id = any($1::uuid[])
       order by array_position($1::uuid[], queue.id)`,
      [queueIds],
    );
    expect(
      queueEntries.rows.every((row) =>
        row.canonical_dictionary_id_snapshot.startsWith("word:"),
      ),
    ).toBe(true);

    const questions = queueEntries.rows.map((queue, index) => ({
      vocab_entry_id: queue.vocab_entry_id,
      base_order_index: index + 1,
      direction:
        index < 2 ? "english_to_korean" : "korean_to_english",
      choice_vocab_entry_ids: entryIds,
    }));
    const exact = await database.query<{ assignment_id: string }>(
      `select private.create_exact_review_assignment_v5(
        $1::uuid,
        $2::uuid,
        $3::uuid[],
        'Dictionary exact review',
        50::smallint,
        60,
        80::smallint,
        'fixed'::public.question_order_mode,
        clock_timestamp() + interval '1 day',
        'total',
        null,
        $4::jsonb
      ) as assignment_id`,
      [ids.student, datasetId, queueIds, JSON.stringify(questions)],
    );
    const exactAssignmentId = exact.rows[0]!.assignment_id;
    dictionaryExactAssignmentId = exactAssignmentId;

    const exactState = await database.query<{
      assignment_purpose: string;
      target_count: number;
      dictionary_target_count: number;
      pending_queue_count: number;
      snapshot_count: number;
    }>(`
      select
        assignment.assignment_purpose,
        (select count(*)::integer
          from public.assignment_review_targets as target
          where target.assignment_id = assignment.id
            and target.student_id = '${ids.student}'
            and target.released_at is null) as target_count,
        (select count(*)::integer
          from public.assignment_review_targets as target
          where target.assignment_id = assignment.id
            and target.student_id = '${ids.student}'
            and target.released_at is null
            and target.canonical_dictionary_id_snapshot is not null)
          as dictionary_target_count,
        (select count(*)::integer
          from public.student_vocab_review_queue as queue
          where queue.id = any(array[
            ${queueIds.map((id) => `'${id}'::uuid`).join(",")}
          ]::uuid[])
            and queue.status = 'pending') as pending_queue_count,
        (select count(*)::integer
          from public.assignment_question_exam_use_snapshot as snapshot
          where snapshot.assignment_id = assignment.id
            and snapshot.release_id = '${releaseId}') as snapshot_count
      from public.assignments as assignment
      where assignment.id = '${exactAssignmentId}';
    `);
    expect(exactState.rows[0]).toEqual({
      assignment_purpose: "review",
      target_count: 4,
      dictionary_target_count: 4,
      pending_queue_count: 4,
      snapshot_count: 4,
    });
  });

  it("creates and starts a one-word exact review through the active exam-use release", async () => {
    expect(exactQueueIds).toHaveLength(4);
    expect(dictionaryExactAssignmentId).toMatch(/^[0-9a-f-]{36}$/i);

    await database.exec("set role authenticated;");
    await database.query(
      `select public.cancel_student_assignment_v1(
        $1::uuid,
        $2::uuid,
        'one-word exact review fixture'
      )`,
      [dictionaryExactAssignmentId, ids.student],
    );
    await database.exec("reset role;");

    const queueEntry = await database.query<{ vocab_entry_id: number }>(
      `select vocab_entry_id
       from public.student_vocab_review_queue
       where id = $1::uuid
         and student_id = $2::uuid
         and status = 'pending'`,
      [exactQueueIds[0], ids.student],
    );
    expect(queueEntry.rows).toHaveLength(1);
    const oneQuestion = JSON.stringify([{
      vocab_entry_id: queueEntry.rows[0]!.vocab_entry_id,
      base_order_index: 1,
      direction: "english_to_korean",
      choice_vocab_entry_ids: entryIds,
    }]);

    await database.exec("set role authenticated;");
    await expect(database.query(
      `select public.create_assignment_with_delivery_v6(
        'Regular one-word assignment must stay blocked',
        $1::uuid,
        array[$2::uuid],
        1,
        100::smallint,
        300,
        80::smallint,
        'fixed'::public.question_order_mode,
        clock_timestamp() + interval '1 day',
        array[$3::uuid],
        'total',
        null,
        $4::jsonb
      )`,
      [datasetId, unitId, ids.student, oneQuestion],
    )).rejects.toThrow("invalid_exam_use_question_settings");

    const created = await database.query<{ assignment_id: string }>(
      `select public.create_exact_review_assignment_v7(
        $1::uuid,
        $2::uuid,
        array[$3::uuid],
        'Dictionary one-word exact review',
        100::smallint,
        300,
        80::smallint,
        true,
        80::smallint,
        'fixed'::public.question_order_mode,
        clock_timestamp() + interval '1 day',
        'total',
        null,
        $4::jsonb
      ) as assignment_id`,
      [ids.student, datasetId, exactQueueIds[0], oneQuestion],
    );
    await database.exec("reset role;");
    let oneAssignmentId = created.rows[0]!.assignment_id;

    const state = await database.query<{
      assignment_purpose: string;
      question_count: number;
      snapshot_count: number;
      target_count: number;
    }>(`
      select
        assignment.assignment_purpose,
        assignment.question_count,
        (select count(*)::integer
          from public.assignment_question_exam_use_snapshot as snapshot
          where snapshot.assignment_id = assignment.id
            and snapshot.release_id = '${releaseId}') as snapshot_count,
        (select count(*)::integer
          from public.assignment_review_targets as target
          where target.assignment_id = assignment.id
            and target.released_at is null) as target_count
      from public.assignments as assignment
      where assignment.id = '${oneAssignmentId}';
    `);
    expect(state.rows[0]).toEqual({
      assignment_purpose: "review",
      question_count: 1,
      snapshot_count: 1,
      target_count: 1,
    });

    const sourceAssignmentId = oneAssignmentId;
    const replacementKey = "00000000-0000-4000-8000-000000009801";
    await database.exec("set role authenticated;");
    const replacement = await database.query<{
      result: {
        idempotent: boolean;
        replacementAssignmentId: string;
      };
    }>(
      `select public.replace_student_assignment_v6(
        $1::uuid,
        $2::uuid,
        $3::uuid,
        repeat('b', 64),
        'review',
        'preserve',
        'Dictionary one-word exact review edited',
        $4::uuid,
        array[]::uuid[],
        1,
        100::smallint,
        300,
        80::smallint,
        true,
        80::smallint,
        'ascending'::public.question_order_mode,
        (select available_from from public.assignments where id = $1::uuid),
        (select available_until from public.assignments where id = $1::uuid),
        'total',
        null,
        array[1]::smallint[],
        'dataset',
        array[$5::uuid],
        $6::jsonb
      ) as result`,
      [
        sourceAssignmentId,
        ids.student,
        replacementKey,
        datasetId,
        exactQueueIds[0],
        oneQuestion,
      ],
    );
    const replay = await database.query<{
      result: {
        idempotent: boolean;
        replacementAssignmentId: string;
      };
    }>(
      `select public.replace_student_assignment_v6(
        $1::uuid,
        $2::uuid,
        $3::uuid,
        repeat('b', 64),
        'review',
        'preserve',
        'Dictionary one-word exact review edited',
        $4::uuid,
        array[]::uuid[],
        1,
        100::smallint,
        300,
        80::smallint,
        true,
        80::smallint,
        'ascending'::public.question_order_mode,
        (select available_from from public.assignments where id = $1::uuid),
        (select available_until from public.assignments where id = $1::uuid),
        'total',
        null,
        array[1]::smallint[],
        'dataset',
        array[$5::uuid],
        $6::jsonb
      ) as result`,
      [
        sourceAssignmentId,
        ids.student,
        replacementKey,
        datasetId,
        exactQueueIds[0],
        oneQuestion,
      ],
    );
    await database.exec("reset role;");

    oneAssignmentId = replacement.rows[0]!.result.replacementAssignmentId;
    expect(replacement.rows[0]!.result.idempotent).toBe(false);
    expect(replay.rows[0]!.result).toEqual({
      idempotent: true,
      replacementAssignmentId: oneAssignmentId,
      replacementPurpose: "review",
      sourceAssignmentId,
      status: "replaced",
      studentId: ids.student,
    });

    const replacementState = await database.query<{
      primary_unit_count: number;
      queue_pending: boolean;
      replacement_active_targets: number;
      replacement_bank_hash: string;
      replacement_question_hash: string;
      replacement_request_count: number;
      review_scope: string;
      retry_enabled: boolean;
      retry_passing_score: number;
      snapshot_count: number;
      source_active_targets: number;
      source_bank_hash: string;
      source_cancelled: boolean;
      source_question_hash: string;
    }>(`
      select
        source_link.cancelled_at is not null as source_cancelled,
        source_assignment.question_bank_sha256 as source_bank_hash,
        replacement_assignment.question_bank_sha256 as replacement_bank_hash,
        replacement_assignment.review_scope,
        replacement_assignment.retry_enabled,
        replacement_assignment.retry_passing_score,
        (
          select question_content_sha256
          from public.assignment_questions
          where assignment_id = '${sourceAssignmentId}'
        ) as source_question_hash,
        (
          select question_content_sha256
          from public.assignment_questions
          where assignment_id = '${oneAssignmentId}'
        ) as replacement_question_hash,
        (
          select count(*)::integer
          from public.assignment_units
          where assignment_id = '${oneAssignmentId}'
            and is_primary
        ) as primary_unit_count,
        (
          select count(*)::integer
          from public.assignment_review_targets
          where assignment_id = '${sourceAssignmentId}'
            and released_at is null
        ) as source_active_targets,
        (
          select count(*)::integer
          from public.assignment_review_targets
          where assignment_id = '${oneAssignmentId}'
            and released_at is null
        ) as replacement_active_targets,
        (
          select count(*)::integer
          from public.assignment_question_exam_use_snapshot
          where assignment_id = '${oneAssignmentId}'
            and release_id = '${releaseId}'
        ) as snapshot_count,
        (
          select status = 'pending' and consumed_assignment_id is null
          from public.student_vocab_review_queue
          where id = '${exactQueueIds[0]}'
        ) as queue_pending,
        (
          select count(*)::integer
          from private.assignment_replacement_requests
          where source_assignment_id = '${sourceAssignmentId}'
            and student_id = '${ids.student}'
        ) as replacement_request_count
      from public.assignments as source_assignment
      join public.assignment_students as source_link
        on source_link.assignment_id = source_assignment.id
       and source_link.student_id = '${ids.student}'
      cross join public.assignments as replacement_assignment
      where source_assignment.id = '${sourceAssignmentId}'
        and replacement_assignment.id = '${oneAssignmentId}';
    `);
    expect(replacementState.rows[0]).toMatchObject({
      primary_unit_count: 0,
      queue_pending: true,
      replacement_active_targets: 1,
      replacement_request_count: 1,
      review_scope: "dataset",
      retry_enabled: true,
      retry_passing_score: 80,
      snapshot_count: 1,
      source_active_targets: 0,
      source_cancelled: true,
    });
    expect(replacementState.rows[0]!.replacement_bank_hash).toBe(
      replacementState.rows[0]!.source_bank_hash,
    );
    expect(replacementState.rows[0]!.replacement_question_hash).toBe(
      replacementState.rows[0]!.source_question_hash,
    );

    const attempt = await database.query<{ attempt_id: string }>(`
      select public.create_quiz_attempt_from_bank(
        '${ids.student}',
        '${oneAssignmentId}'
      ) as attempt_id;
    `);
    const attemptId = attempt.rows[0]!.attempt_id;
    const attemptState = await database.query<{
      phase: string;
      question_count: number;
      status: string;
    }>(`
      select
        attempt.phase::text,
        attempt.status::text,
        (select count(*)::integer
          from public.quiz_questions as question
          where question.attempt_id = attempt.id) as question_count
      from public.quiz_attempts as attempt
      where attempt.id = '${attemptId}';
    `);
    expect(attemptState.rows[0]).toEqual({
      phase: "initial",
      question_count: 1,
      status: "in_progress",
    });

    await database.exec(`
      delete from public.quiz_attempts where id = '${attemptId}';
    `);
    await database.exec("set role authenticated;");
    await database.query(
      `select public.cancel_student_assignment_v1(
        $1::uuid,
        $2::uuid,
        'release one-word exact review fixture'
      )`,
      [oneAssignmentId, ids.student],
    );
    await database.exec("reset role;");
  });

  it("replaces two- and three-word exact reviews through the active exam-use release", async () => {
    for (const targetCount of [2, 3]) {
      const selectedQueueIds = exactQueueIds.slice(0, targetCount);
      const queueEntries = await database.query<{ vocab_entry_id: number }>(
        `select vocab_entry_id
         from public.student_vocab_review_queue
         where id = any($1::uuid[])
           and student_id = $2::uuid
           and status = 'pending'
         order by array_position($1::uuid[], id)`,
        [selectedQueueIds, ids.student],
      );
      expect(queueEntries.rows).toHaveLength(targetCount);
      const questions = JSON.stringify(
        queueEntries.rows.map((queue, index) => ({
          vocab_entry_id: queue.vocab_entry_id,
          base_order_index: index + 1,
          direction: "english_to_korean",
          choice_vocab_entry_ids: entryIds,
        })),
      );

      await database.exec("set role authenticated;");
      const source = await database.query<{ assignment_id: string }>(
        `select public.create_exact_review_assignment_v7(
          $1::uuid,
          $2::uuid,
          $3::uuid[],
          $4,
          100::smallint,
          300,
          80::smallint,
          true,
          80::smallint,
          'fixed'::public.question_order_mode,
          clock_timestamp() + interval '1 day',
          'total',
          null,
          $5::jsonb
        ) as assignment_id`,
        [
          ids.student,
          datasetId,
          selectedQueueIds,
          `Dictionary ${targetCount}-word exact review`,
          questions,
        ],
      );
      const sourceAssignmentId = source.rows[0]!.assignment_id;
      const replacementKey =
        `00000000-0000-4000-8000-00000000980${targetCount}`;
      const replacement = await database.query<{
        result: { replacementAssignmentId: string };
      }>(
        `select public.replace_student_assignment_v6(
          $1::uuid, $2::uuid, $3::uuid, repeat('c', 64),
          'review', 'preserve', $4, $5::uuid, array[]::uuid[],
          $6::integer, 100::smallint, 300, 80::smallint, true, 80::smallint,
          'ascending'::public.question_order_mode,
          (select available_from from public.assignments where id = $1::uuid),
          (select available_until from public.assignments where id = $1::uuid),
          'total', null, array[1]::smallint[], 'dataset', $7::uuid[],
          $8::jsonb
        ) as result`,
        [
          sourceAssignmentId,
          ids.student,
          replacementKey,
          `Dictionary ${targetCount}-word exact review edited`,
          datasetId,
          targetCount,
          selectedQueueIds,
          questions,
        ],
      );
      await database.exec("reset role;");
      const replacementAssignmentId =
        replacement.rows[0]!.result.replacementAssignmentId;

      const state = await database.query<{
        active_targets: number;
        pending_queues: number;
        question_count: number;
        snapshots: number;
        source_cancelled: boolean;
      }>(`
        select
          link.cancelled_at is not null as source_cancelled,
          replacement.question_count,
          (
            select count(*)::integer
            from public.assignment_review_targets
            where assignment_id = '${replacementAssignmentId}'
              and released_at is null
          ) as active_targets,
          (
            select count(*)::integer
            from public.assignment_question_exam_use_snapshot
            where assignment_id = '${replacementAssignmentId}'
              and release_id = '${releaseId}'
          ) as snapshots,
          (
            select count(*)::integer
            from public.student_vocab_review_queue
            where id = any(array[
              ${selectedQueueIds.map((id) => `'${id}'::uuid`).join(",")}
            ]::uuid[])
              and status = 'pending'
              and consumed_assignment_id is null
          ) as pending_queues
        from public.assignment_students as link
        cross join public.assignments as replacement
        where link.assignment_id = '${sourceAssignmentId}'
          and link.student_id = '${ids.student}'
          and replacement.id = '${replacementAssignmentId}';
      `);
      expect(state.rows[0]).toEqual({
        active_targets: targetCount,
        pending_queues: targetCount,
        question_count: targetCount,
        snapshots: targetCount,
        source_cancelled: true,
      });

      await database.exec("set role authenticated;");
      await database.query(
        `select public.cancel_student_assignment_v1(
          $1::uuid, $2::uuid, 'next active-release replacement fixture'
        )`,
        [replacementAssignmentId, ids.student],
      );
      await database.exec("reset role;");
    }
  });

  it("remaps historical queues to the active release through the public mixed RPC", async () => {
    const remapUnitId = "00000000-0000-4000-8000-000000009101";
    const remapReleaseId = "00000000-0000-4000-8000-000000009102";
    await database.exec(`
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
      values (
        '${remapUnitId}',
        '${datasetId}',
        '2025-02 장문독해',
        '2025-02 장문독해',
        'supplement',
        null,
        2,
        4
      );

      insert into public.vocab_entries (
        dataset_id,
        source_row,
        headword,
        headword_normalized,
        pronunciation_ko,
        meanings,
        primary_meaning,
        english_definition,
        example_en,
        example_ko,
        source_ref,
        row_sha256,
        unit_id,
        position_in_unit,
        entry_type
      )
      select
        entry.dataset_id,
        entry.source_row + 100,
        entry.headword,
        entry.headword_normalized,
        entry.pronunciation_ko,
        entry.meanings,
        entry.primary_meaning,
        entry.english_definition,
        entry.example_en,
        entry.example_ko,
        '2025-02 장문독해 · word',
        upper(lpad(to_hex(entry.source_row + 100), 64, 'f')),
        '${remapUnitId}',
        entry.position_in_unit,
        entry.entry_type
      from public.vocab_entries as entry
      where entry.id = any(array[
        ${entryIds.map((id) => `${id}::bigint`).join(",")}
      ]::bigint[]);

      update word_index.app_exam_use_release
      set status = 'retired',
          retired_at_utc = clock_timestamp()
      where release_id = '${releaseId}';

      insert into word_index.app_exam_use_release (
        release_id,
        release_key,
        dataset_id,
        dataset_key,
        schema_version,
        package_version,
        source_sha256,
        candidate_dictionary_version,
        manifest_content_hash,
        exam_review_ledger_sha256,
        wordbook_id,
        title,
        target_environment,
        common_dictionary_release_allowed,
        exam_use_import_allowed,
        expected_occurrence_count,
        expected_dictionary_count,
        expected_included_count,
        status,
        package_json
      )
      values (
        '${remapReleaseId}',
        'integration-exam-use-v1:remap',
        '${datasetId}',
        'integration-exam-use-v1',
        '1.0',
        repeat('9', 64),
        repeat('8', 64),
        repeat('7', 64),
        repeat('6', 64),
        repeat('5', 64),
        'integration-wordbook',
        '통합 테스트용 가짜 단어장 새 릴리스',
        'preview',
        false,
        true,
        4,
        4,
        4,
        'loading',
        '{}'::jsonb
      );

      insert into word_index.app_exam_use_occurrence (
        release_id,
        dataset_id,
        source_row,
        vocab_entry_id,
        unit_id,
        position_in_unit,
        dictionary_id,
        legacy_ids,
        sense_id,
        pronunciation_variant_id,
        display_headword,
        display_gloss_ko,
        display_pronunciation_ko,
        display_pronunciation_review_status,
        audio_status,
        audio_url,
        sound_audio,
        raw_response_sha256,
        listening_enabled,
        occurrence_id,
        occurrence_content_hash,
        package_entry_content_hash,
        exam_review_id,
        exam_input_hash,
        exam_use_status,
        context_evidence_status,
        context_evidence,
        source_projection_row_sha256,
        source_entry_id,
        source_entry_sha256,
        include_in_exam,
        manual_review_flags,
        audio_json,
        package_entry_json
      )
      select
        '${remapReleaseId}',
        occurrence.dataset_id,
        occurrence.source_row + 100,
        current_entry.id,
        '${remapUnitId}',
        occurrence.position_in_unit,
        occurrence.dictionary_id,
        occurrence.legacy_ids,
        occurrence.sense_id,
        occurrence.pronunciation_variant_id,
        occurrence.display_headword,
        occurrence.display_gloss_ko,
        occurrence.display_pronunciation_ko,
        occurrence.display_pronunciation_review_status,
        occurrence.audio_status,
        occurrence.audio_url,
        occurrence.sound_audio,
        occurrence.raw_response_sha256,
        occurrence.listening_enabled,
        'occ:integration-remap-' || occurrence.source_row,
        occurrence.occurrence_content_hash,
        occurrence.package_entry_content_hash,
        'exam-review:integration-remap-' || occurrence.source_row,
        occurrence.exam_input_hash,
        occurrence.exam_use_status,
        occurrence.context_evidence_status,
        occurrence.context_evidence,
        occurrence.source_projection_row_sha256,
        'entry-integration-remap-' || occurrence.source_row,
        occurrence.source_entry_sha256,
        occurrence.include_in_exam,
        occurrence.manual_review_flags,
        occurrence.audio_json,
        occurrence.package_entry_json
      from word_index.app_exam_use_occurrence as occurrence
      join public.vocab_entries as current_entry
        on current_entry.dataset_id = occurrence.dataset_id
       and current_entry.source_row = occurrence.source_row + 100
      where occurrence.release_id = '${releaseId}';

      update word_index.app_exam_use_release
      set status = 'active',
          activated_at_utc = clock_timestamp()
      where release_id = '${remapReleaseId}';

      update public.vocab_datasets
      set metadata = jsonb_set(
        metadata,
        '{packageVersion}',
        to_jsonb(repeat('9', 64))
      )
      where id = '${datasetId}';
    `);

    const candidates = await database.query<{
      queue_id: string;
      reason_level: number;
      dictionary_id: string;
      historical_entry_id: number;
      current_entry_id: number;
    }>(`
      select
        queue.id as queue_id,
        queue.reason_level,
        queue.canonical_dictionary_id_snapshot as dictionary_id,
        queue.vocab_entry_id as historical_entry_id,
        occurrence.vocab_entry_id as current_entry_id
      from public.student_vocab_review_queue as queue
      join word_index.app_exam_use_occurrence as occurrence
        on occurrence.release_id = '${remapReleaseId}'
       and occurrence.dataset_id = queue.dataset_id
       and occurrence.dictionary_id = queue.canonical_dictionary_id_snapshot
       and occurrence.include_in_exam
       and occurrence.exam_use_status = 'reviewed_for_preview'
      where queue.student_id = '${ids.student}'
        and queue.dataset_id = '${datasetId}'
        and queue.status = 'pending'
      order by queue.reason_level desc, queue.queued_at, queue.id;
    `);
    expect(candidates.rows).toHaveLength(4);
    expect(
      candidates.rows.every(
        (candidate) =>
          candidate.historical_entry_id !== candidate.current_entry_id,
      ),
    ).toBe(true);

    const queueIds = candidates.rows.map((candidate) => candidate.queue_id);
    const currentEntryIds = candidates.rows.map(
      (candidate) => candidate.current_entry_id,
    );
    const reviewLevels = [
      ...new Set(candidates.rows.map((candidate) => candidate.reason_level)),
    ];
    const questions = candidates.rows.map((candidate, index) => ({
      vocab_entry_id: candidate.current_entry_id,
      base_order_index: index + 1,
      direction:
        index < 2 ? "english_to_korean" : "korean_to_english",
      choice_vocab_entry_ids: currentEntryIds,
    }));

    await database.exec("set role authenticated;");
    const mixed = await database.query<{ assignment_id: string }>(
      `select public.create_mixed_review_assignment_v8(
        $1::uuid,
        $2::uuid,
        $3::smallint[],
        'dataset',
        $4::uuid[],
        'Dictionary release remap',
        array[]::uuid[],
        50::smallint,
        60,
        80::smallint,
        'fixed'::public.question_order_mode,
        null,
        'total',
        null,
        $5::jsonb
      ) as assignment_id`,
      [
        ids.student,
        datasetId,
        reviewLevels,
        queueIds,
        JSON.stringify(questions),
      ],
    );
    const identities = await database.query<{
      assignment_id: string;
      vocab_entry_id: number;
      canonical_dictionary_id: string;
    }>(
      `select *
       from public.list_assignment_question_dictionary_identities_v1(
         array[$1::uuid],
         $2::uuid
       )`,
      [mixed.rows[0]!.assignment_id, datasetId],
    );
    await database.exec("reset role;");

    expect(identities.rows).toHaveLength(4);
    expect(
      new Set(identities.rows.map((identity) => identity.vocab_entry_id)),
    ).toEqual(new Set(currentEntryIds));
    expect(
      new Set(
        identities.rows.map((identity) => identity.canonical_dictionary_id),
      ),
    ).toEqual(new Set(candidates.rows.map((candidate) => candidate.dictionary_id)));

    const remappedState = await database.query<{
      assignment_purpose: string;
      active_target_count: number;
      historical_target_count: number;
      active_release_snapshot_count: number;
    }>(`
      select
        assignment.assignment_purpose,
        (
          select count(*)::integer
          from public.assignment_review_targets as target
          where target.assignment_id = assignment.id
            and target.student_id = '${ids.student}'
            and target.released_at is null
        ) as active_target_count,
        (
          select count(*)::integer
          from public.assignment_review_targets as target
          join public.student_vocab_review_queue as queue
            on queue.id = target.review_queue_id
          where target.assignment_id = assignment.id
            and target.student_id = '${ids.student}'
            and target.vocab_entry_id <> queue.vocab_entry_id
        ) as historical_target_count,
        (
          select count(*)::integer
          from public.assignment_question_exam_use_snapshot as snapshot
          where snapshot.assignment_id = assignment.id
            and snapshot.release_id = '${remapReleaseId}'
        ) as active_release_snapshot_count
      from public.assignments as assignment
      where assignment.id = '${mixed.rows[0]!.assignment_id}';
    `);
    expect(remappedState.rows[0]).toEqual({
      assignment_purpose: "review",
      active_target_count: 4,
      historical_target_count: 4,
      active_release_snapshot_count: 4,
    });
  });

  it("creates a release-aware regular assignment through the public bulk RPC", async () => {
    const remapAssignment = await database.query<{ id: string }>(`
      select id
      from public.assignments
      where title = 'Dictionary release remap'
      order by created_at desc
      limit 1;
    `);
    const remapRelease = await database.query<{
      release_id: string;
      unit_id: string;
      vocab_entry_id: number;
    }>(`
      select
        occurrence.release_id,
        occurrence.unit_id,
        occurrence.vocab_entry_id
      from word_index.app_exam_use_occurrence as occurrence
      join word_index.app_exam_use_release as release
        on release.release_id = occurrence.release_id
       and release.status = 'active'
      where occurrence.dataset_id = '${datasetId}'
        and occurrence.include_in_exam
        and occurrence.exam_use_status = 'reviewed_for_preview'
      order by occurrence.source_row;
    `);
    expect(remapRelease.rows).toHaveLength(4);

    const currentEntryIds = remapRelease.rows.map(
      (occurrence) => occurrence.vocab_entry_id,
    );
    const questions = currentEntryIds.map((entryId, index) => ({
      vocab_entry_id: entryId,
      base_order_index: index + 1,
      direction:
        index < 2 ? "english_to_korean" : "korean_to_english",
      choice_vocab_entry_ids: currentEntryIds,
    }));
    const batches = [
      {
        kind: "regular",
        student_id: ids.student,
        title: "Dictionary bulk regular",
        dataset_id: datasetId,
        unit_ids: [remapRelease.rows[0]!.unit_id],
        question_count: 4,
        english_to_korean_ratio: 50,
        time_limit_seconds: 60,
        passing_score: 80,
        question_order_mode: "fixed",
        session_number: 1,
        session_count: 1,
        available_from: "2035-12-31T09:00:00.000Z",
        available_until: null,
        timing_mode: "total",
        question_time_limit_seconds: null,
        questions,
      },
    ];

    await database.exec("set role authenticated;");
    await database.query(
      `select public.cancel_student_assignment_v1(
        $1::uuid,
        $2::uuid,
        'bulk assignment fixture'
      )`,
      [remapAssignment.rows[0]!.id, ids.student],
    );
    const bulk = await database.query<{
      result: Array<{ student_id: string; assignment_id: string }>;
    }>(
      `select public.create_bulk_vocab_assignments_v8(
        $1::uuid,
        $2::text,
        $3::jsonb
      ) as result`,
      [
        "a3d82325-332a-44bb-b0ec-f225f22f6554",
        "a".repeat(64),
        JSON.stringify(batches),
      ],
    );
    await database.exec("reset role;");

    expect(bulk.rows[0]!.result).toHaveLength(1);
    expect(bulk.rows[0]!.result[0]?.student_id).toBe(ids.student);
    const bulkAssignmentId = bulk.rows[0]!.result[0]!.assignment_id;
    const bulkState = await database.query<{
      question_count: number;
      recipient_count: number;
      snapshot_count: number;
    }>(`
      select
        assignment.question_count,
        (
          select count(*)::integer
          from public.assignment_students as recipient
          where recipient.assignment_id = assignment.id
            and recipient.student_id = '${ids.student}'
            and recipient.cancelled_at is null
        ) as recipient_count,
        (
          select count(*)::integer
          from public.assignment_question_exam_use_snapshot as snapshot
          where snapshot.assignment_id = assignment.id
            and snapshot.release_id = '${remapRelease.rows[0]!.release_id}'
        ) as snapshot_count
      from public.assignments as assignment
      where assignment.id = '${bulkAssignmentId}';
    `);
    expect(bulkState.rows[0]).toEqual({
      question_count: 4,
      recipient_count: 1,
      snapshot_count: 4,
    });
  });

  it("분할 큐는 첫 시험만 만들고 완료 뒤 다음 한 회차만 멱등 생성한다", async () => {
    const cancellable = await database.query<{ assignment_id: string }>(`
      select link.assignment_id::text
      from public.assignment_students as link
      where link.student_id = '${ids.student}'
        and link.cancelled_at is null
        and not exists (
          select 1 from public.quiz_attempts as attempt
          where attempt.assignment_id = link.assignment_id
            and attempt.student_id = link.student_id
        );
    `);
    await database.exec("set role authenticated;");
    for (const link of cancellable.rows) {
      await database.query(
        `select public.cancel_student_assignment_v1(
          $1::uuid, $2::uuid, 'completion queue test cleanup'
        )`,
        [link.assignment_id, ids.student],
      );
    }
    await database.exec("reset role;");
    const source = await database.query<{
      unit_id: string;
      vocab_entry_id: number;
    }>(`
      select occurrence.unit_id::text, occurrence.vocab_entry_id
      from word_index.app_exam_use_occurrence as occurrence
      join word_index.app_exam_use_release as release
        on release.release_id = occurrence.release_id
       and release.status = 'active'
      where occurrence.dataset_id = '${datasetId}'
        and occurrence.include_in_exam
      order by occurrence.source_row;
    `);
    const currentEntryIds = source.rows.map((row) => row.vocab_entry_id);
    const questions = currentEntryIds.map((entryId, index) => ({
      vocab_entry_id: entryId,
      base_order_index: index + 1,
      direction:
        index < 2 ? "english_to_korean" : "korean_to_english",
      choice_vocab_entry_ids: currentEntryIds,
    }));
    const firstFrom = new Date(Date.now() - 60_000);
    const firstUntil = new Date(Date.now() + 60 * 60_000);
    const secondFrom = new Date(Date.now() + 2 * 24 * 60 * 60_000);
    const secondUntil = new Date(secondFrom.getTime() + 60 * 60_000);
    const thirdFrom = new Date(Date.now() + 4 * 24 * 60 * 60_000);
    const thirdUntil = new Date(thirdFrom.getTime() + 60 * 60_000);
    const commonBatch = {
      kind: "regular",
      student_id: ids.student,
      title: "Completion queue integration",
      dataset_id: datasetId,
      unit_ids: [source.rows[0]!.unit_id],
      unit_labels: ["통합 DAY"],
      question_count: 4,
      english_to_korean_ratio: 50,
      time_limit_seconds: 3600,
      passing_score: 80,
      question_order_mode: "fixed",
      timing_mode: "total",
      question_time_limit_seconds: null,
      session_count: 3,
      questions,
    };
    const queueInput = [
      {
        student_id: ids.student,
        dataset_id: datasetId,
        dataset_label: "통합 테스트용 가짜 단어장",
        range_label: "통합 DAY",
        recurrence_slots: [
          { isodow: 1, local_time: "15:00:00", duration_seconds: 3600 },
          { isodow: 3, local_time: "15:00:00", duration_seconds: 3600 },
          { isodow: 5, local_time: "15:00:00", duration_seconds: 3600 },
        ],
        items: [
          {
            ...commonBatch,
            session_number: 1,
            available_from: firstFrom.toISOString(),
            available_until: firstUntil.toISOString(),
          },
          {
            ...commonBatch,
            session_number: 2,
            available_from: secondFrom.toISOString(),
            available_until: secondUntil.toISOString(),
          },
          {
            ...commonBatch,
            session_number: 3,
            available_from: thirdFrom.toISOString(),
            available_until: thirdUntil.toISOString(),
          },
        ],
      },
    ];

    await database.exec("set role authenticated;");
    const created = await database.query<{
      result: Array<{
        assignment_id: string | null;
        queue_series_id: string;
        session_number: number;
        status: string;
      }>;
    }>(
      `select public.create_vocab_assignment_queues_v1(
        $1::uuid, $2::text, $3::jsonb
      ) as result`,
      [
        "b4d82325-332a-44bb-b0ec-f225f22f6554",
        "b".repeat(64),
        JSON.stringify(queueInput),
      ],
    );
    await database.exec("reset role;");

    expect(created.rows[0]!.result.map((item) => item.status)).toEqual([
      "assigned",
      "queued",
      "queued",
    ]);
    expect(created.rows[0]!.result[1]!.assignment_id).toBeNull();
    const firstAssignmentId = created.rows[0]!.result[0]!.assignment_id!;

    const attempt = await database.query<{ id: string }>(`
      select public.create_quiz_attempt_from_bank(
        '${ids.student}', '${firstAssignmentId}'
      ) as id;
    `);
    const quizQuestions = await database.query<{
      id: string;
      correct_choice_index: number;
    }>(`
      select id::text, correct_choice_index
      from public.quiz_questions
      where attempt_id = '${attempt.rows[0]!.id}'
      order by order_index;
    `);
    for (const question of quizQuestions.rows) {
      await database.query(
        `select public.answer_quiz_question_v2(
          $1::uuid, $2::uuid, $3::uuid, 'initial', $4::smallint, false
        )`,
        [
          ids.student,
          attempt.rows[0]!.id,
          question.id,
          (question.correct_choice_index + 1) % 4,
        ],
      );
    }

    const reviewState = await database.query<{
      status: string;
      phase: string;
    }>(`
      select status::text, phase
      from public.quiz_attempts
      where id = '${attempt.rows[0]!.id}';
    `);
    expect(reviewState.rows[0]).toEqual({
      status: "in_progress",
      phase: "review",
    });

    await database.exec(`
      set role service_role;
      select set_config('request.jwt.claim.role', 'service_role', false);
      select set_config('request.jwt.claims', '{"role":"service_role"}', false);
    `);
    const prematureMaterialize = await database.query<{ result: unknown[] }>(`
      select public.materialize_ready_vocab_assignment_queue_v1(
        '${ids.student}', 10
      ) as result;
    `);
    await database.exec(`
      reset role;
      select set_config('request.jwt.claim.role', 'authenticated', false);
      select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
    `);
    expect(prematureMaterialize.rows[0]!.result).toEqual([]);

    const waitingState = await database.query<{
      statuses: string[];
      assignment_count: number;
    }>(`
      select
        array_agg(item.status order by item.sequence_number) as statuses,
        count(item.assignment_id)::integer as assignment_count
      from private.vocab_assignment_series_items as item
      where item.series_id = '${created.rows[0]!.result[0]!.queue_series_id}';
    `);
    expect(waitingState.rows[0]).toEqual({
      statuses: ["assigned", "queued", "queued"],
      assignment_count: 1,
    });

    await database.query(
      "select public.start_quiz_retry($1::uuid, $2::uuid)",
      [ids.student, attempt.rows[0]!.id],
    );
    for (const question of quizQuestions.rows) {
      await database.query(
        `select public.answer_quiz_question_v2(
          $1::uuid, $2::uuid, $3::uuid, 'retry', $4::smallint, false
        )`,
        [
          ids.student,
          attempt.rows[0]!.id,
          question.id,
          (question.correct_choice_index + 1) % 4,
        ],
      );
    }

    const completedAttempt = await database.query<{
      status: string;
      passed: boolean;
    }>(`
      select status::text, passed
      from public.quiz_attempts
      where id = '${attempt.rows[0]!.id}';
    `);
    expect(completedAttempt.rows[0]).toEqual({
      status: "completed",
      passed: false,
    });

    const readyState = await database.query<{
      statuses: string[];
      assignment_count: number;
    }>(`
      select
        array_agg(item.status order by item.sequence_number) as statuses,
        count(item.assignment_id)::integer as assignment_count
      from private.vocab_assignment_series_items as item
      where item.series_id = '${created.rows[0]!.result[0]!.queue_series_id}';
    `);
    expect(readyState.rows[0]).toEqual({
      statuses: ["completed", "ready", "queued"],
      assignment_count: 1,
    });

    await database.exec(`
      set role service_role;
      select set_config('request.jwt.claim.role', 'service_role', false);
      select set_config('request.jwt.claims', '{"role":"service_role"}', false);
    `);
    const firstMaterialize = await database.query<{
      result: Array<{ assignment_id: string }>;
    }>(`
      select public.materialize_ready_vocab_assignment_queue_v1(
        '${ids.student}', 10
      ) as result;
    `);
    const secondMaterialize = await database.query<{ result: unknown[] }>(`
      select public.materialize_ready_vocab_assignment_queue_v1(
        '${ids.student}', 10
      ) as result;
    `);
    await database.exec(`
      reset role;
      select set_config('request.jwt.claim.role', 'authenticated', false);
      select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
    `);
    expect(firstMaterialize.rows[0]!.result).toHaveLength(1);
    expect(secondMaterialize.rows[0]!.result).toEqual([]);

    const assignedState = await database.query<{
      statuses: string[];
      assignment_count: number;
      event_count: number;
    }>(`
      select
        array_agg(item.status order by item.sequence_number) as statuses,
        count(item.assignment_id)::integer as assignment_count,
        (
          select count(*)::integer
          from private.vocab_assignment_series_events as event
          where event.series_id = item.series_id
        ) as event_count
      from private.vocab_assignment_series_items as item
      where item.series_id = '${created.rows[0]!.result[0]!.queue_series_id}'
      group by item.series_id;
    `);
    expect(assignedState.rows[0]).toEqual({
      statuses: ["completed", "assigned", "queued"],
      assignment_count: 2,
      event_count: 5,
    });

    const secondAssignmentId =
      firstMaterialize.rows[0]!.result[0]!.assignment_id;
    await database.exec(`
      update public.assignments
      set available_from = clock_timestamp() - interval '1 minute',
          available_until = clock_timestamp() + interval '1 hour'
      where id = '${secondAssignmentId}';
    `);
    const expiredAttempt = await database.query<{ id: string }>(`
      select public.create_quiz_attempt_from_bank(
        '${ids.student}', '${secondAssignmentId}'
      ) as id;
    `);
    await database.exec(`
      update public.quiz_attempts
      set started_at = clock_timestamp() - interval '2 hours',
          current_question_started_at = clock_timestamp() - interval '2 hours',
          deadline_at = clock_timestamp() - interval '1 hour'
      where id = '${expiredAttempt.rows[0]!.id}';
    `);
    await database.query(
      "select public.expire_quiz_attempt($1::uuid, $2::uuid)",
      [ids.student, expiredAttempt.rows[0]!.id],
    );
    const expiredQueue = await database.query<{
      item_status: string;
      series_status: string;
      reason: string;
    }>(`
      select
        item.status as item_status,
        series.status as series_status,
        series.attention_reason as reason
      from private.vocab_assignment_series as series
      join private.vocab_assignment_series_items as item
        on item.series_id = series.id
       and item.sequence_number = 2
      where series.id = '${created.rows[0]!.result[0]!.queue_series_id}';
    `);
    expect(expiredQueue.rows[0]).toEqual({
      item_status: "attention",
      series_status: "attention",
      reason: "assignment_expired",
    });

    await database.exec(`
      set role service_role;
      select set_config('request.jwt.claim.role', 'service_role', false);
      select set_config('request.jwt.claims', '{"role":"service_role"}', false);
    `);
    const blockedMaterialize = await database.query<{ result: unknown[] }>(`
      select public.materialize_ready_vocab_assignment_queue_v1(
        '${ids.student}', 10
      ) as result;
    `);
    await database.exec(`
      reset role;
      select set_config('request.jwt.claim.role', 'authenticated', false);
      select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
    `);
    expect(blockedMaterialize.rows[0]!.result).toEqual([]);

    const blockedQueue = await database.query<{ statuses: string[] }>(`
      select array_agg(item.status order by item.sequence_number) as statuses
      from private.vocab_assignment_series_items as item
      where item.series_id = '${created.rows[0]!.result[0]!.queue_series_id}';
    `);
    expect(blockedQueue.rows[0]!.statuses).toEqual([
      "completed",
      "attention",
      "queued",
    ]);

    await database.exec("set role authenticated;");
    await database.query(
      `select public.resolve_vocab_assignment_queue_attention_v1(
        $1::uuid, 'retry'
      )`,
      [created.rows[0]!.result[0]!.queue_series_id],
    );
    await database.exec("reset role;");
    const retriedQueue = await database.query<{
      statuses: string[];
      assignment_count: number;
      series_status: string;
    }>(`
      select
        array_agg(item.status order by item.sequence_number) as statuses,
        count(item.assignment_id)::integer as assignment_count,
        series.status as series_status
      from private.vocab_assignment_series as series
      join private.vocab_assignment_series_items as item
        on item.series_id = series.id
      where series.id = '${created.rows[0]!.result[0]!.queue_series_id}'
      group by series.status;
    `);
    expect(retriedQueue.rows[0]).toEqual({
      statuses: ["completed", "ready", "queued"],
      assignment_count: 1,
      series_status: "active",
    });

    await database.exec(`
      set role service_role;
      select set_config('request.jwt.claim.role', 'service_role', false);
      select set_config('request.jwt.claims', '{"role":"service_role"}', false);
    `);
    const retriedMaterialize = await database.query<{
      result: Array<{ assignment_id: string }>;
    }>(`
      select public.materialize_ready_vocab_assignment_queue_v1(
        '${ids.student}', 10
      ) as result;
    `);
    await database.exec(`
      reset role;
      select set_config('request.jwt.claim.role', 'authenticated', false);
      select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
    `);
    expect(retriedMaterialize.rows[0]!.result).toHaveLength(1);

    await database.exec("set role authenticated;");
    await database.query(
      `select public.cancel_student_assignment_v1(
        $1::uuid, $2::uuid, 'queue recovery test cleanup'
      )`,
      [
        retriedMaterialize.rows[0]!.result[0]!.assignment_id,
        ids.student,
      ],
    );
    await database.query(
      `select public.resolve_vocab_assignment_queue_attention_v1(
        $1::uuid, 'cancel'
      )`,
      [created.rows[0]!.result[0]!.queue_series_id],
    );
    await database.exec("reset role;");
    const cancelledQueue = await database.query<{
      statuses: string[];
      series_status: string;
    }>(`
      select
        array_agg(item.status order by item.sequence_number) as statuses,
        series.status as series_status
      from private.vocab_assignment_series as series
      join private.vocab_assignment_series_items as item
        on item.series_id = series.id
      where series.id = '${created.rows[0]!.result[0]!.queue_series_id}'
      group by series.status;
    `);
    expect(cancelledQueue.rows[0]).toEqual({
      statuses: ["completed", "cancelled", "cancelled"],
      series_status: "cancelled",
    });
  });
});
