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
  `);
  for (const migrationPath of migrationPaths) {
    const migration = fs
      .readFileSync(migrationPath, "utf8")
      .replace("create extension if not exists pg_cron;", "");
    await database.exec(migration);
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
    await database.exec("set role service_role;");
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
    await database.exec("reset role;");

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
      `select public.create_assignment_with_delivery_v5(
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
});
