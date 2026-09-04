import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SIMSEOK_G10_SCOPE_CORRECTION_EXAM_SETS,
  SIMSEOK_G10_SCOPE_CORRECTION_PREVIEW_PROJECT_REF,
  SIMSEOK_G10_SCOPE_CORRECTION_QUESTION_SETS,
} from "@/lib/vocab/simseok-g10-scope-correction-preview-contract";
import { SIMSEOK_COMBINED_QUESTION_EXPECTED_SETS } from
  "@/lib/vocab/simseok-sem2-question-preview-import-contract";
import { SIMSEOK_SEM2_EXPECTED_SETS } from
  "@/lib/vocab/simseok-sem2-preview-import-contract";

const projectRoot = path.resolve("../..");
const v2ExamDirectory = path.join(
  projectRoot,
  "영어/00_자료투입함/[시안] 제작중/심석고_2학기_단어시험/v2_최신범위/02_앱전달묶음",
);
const v2QuestionDirectory = path.join(
  projectRoot,
  "영어/00_자료투입함/[시안] 제작중/심석고_2학기_단어시험/v2_최신범위/03_통합문항_앱전달묶음",
);
const v3Root = path.join(
  projectRoot,
  "영어/00_자료투입함/[시안] 제작중/심석고_2학기_단어시험/v3_고1_1_2과_정정",
);
const v3ExamDirectory = path.join(v3Root, "02_앱전달묶음");
const v3QuestionDirectory = path.join(v3Root, "03_통합문항_앱전달묶음");

const migrationsDirectory = path.resolve("supabase/migrations");
const migrationPaths = fs
  .readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => path.join(migrationsDirectory, name));

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
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create function auth.role()
    returns text language sql stable set search_path = '' as $$
      select nullif(current_setting('request.jwt.claim.role', true), '');
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
        `migration failed: ${path.basename(migrationPath)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }
  return database;
}

async function assumeRole(
  database: PGlite,
  role: "authenticated" | "service_role",
) {
  await database.exec(`
    set role ${role};
    select set_config(
      'request.jwt.claims',
      '{"role":"${role}","ref":"${SIMSEOK_G10_SCOPE_CORRECTION_PREVIEW_PROJECT_REF}"}',
      false
    );
  `);
}

async function stageCorrection(
  database: PGlite,
  examPackageTexts: string[],
  questionPackageTexts: string[],
) {
  await assumeRole(database, "service_role");
  try {
    return await database.query<{ result: Record<string, unknown> }>(
      `select public.stage_simseok_g10_scope_correction_preview_v3(
        $1::jsonb, $2::jsonb
      ) as result`,
      [JSON.stringify(examPackageTexts), JSON.stringify(questionPackageTexts)],
    );
  } finally {
    await database.exec("reset role;");
  }
}

describe.sequential("심석고 고1 공통영어Ⅱ 1·2과 Preview 원자 교체", () => {
  let database: PGlite;
  let newExamPackageTexts: string[];
  let newQuestionPackageTexts: string[];

  beforeAll(async () => {
    database = await createFinalSchemaDatabase();
    const oldExamPackageTexts = SIMSEOK_SEM2_EXPECTED_SETS.map((item) =>
      fs.readFileSync(path.join(v2ExamDirectory, item.packagePath), "utf8"),
    );
    const oldQuestionPackageTexts = SIMSEOK_COMBINED_QUESTION_EXPECTED_SETS.map(
      (item) =>
        fs.readFileSync(path.join(v2QuestionDirectory, item.packagePath), "utf8"),
    );
    newExamPackageTexts = SIMSEOK_G10_SCOPE_CORRECTION_EXAM_SETS
      .filter((item) => item.stageForCutover)
      .map((item) =>
        fs.readFileSync(path.join(v3ExamDirectory, item.packagePath), "utf8"),
      );
    newQuestionPackageTexts = SIMSEOK_G10_SCOPE_CORRECTION_QUESTION_SETS
      .filter((item) => item.stageForCutover)
      .map((item) =>
        fs.readFileSync(path.join(v3QuestionDirectory, item.packagePath), "utf8"),
      );

    await assumeRole(database, "service_role");
    await database.query(
      "select public.import_simseok_sem2_preview_bundle_v1($1::jsonb)",
      [JSON.stringify(oldExamPackageTexts)],
    );
    await database.query(
      "select public.import_simseok_sem2_combined_question_preview_bundle_v2($1::jsonb)",
      [JSON.stringify(oldQuestionPackageTexts)],
    );
    await database.exec("reset role;");
  }, 120_000);

  afterAll(async () => {
    await database?.close();
  });

  it("authenticated 역할은 stage·preflight·cutover를 모두 실행할 수 없다", async () => {
    await assumeRole(database, "authenticated");
    for (const query of [
      [
        "select public.stage_simseok_g10_scope_correction_preview_v3($1::jsonb, $2::jsonb)",
        [JSON.stringify(newExamPackageTexts), JSON.stringify(newQuestionPackageTexts)],
      ] as const,
      ["select public.preflight_simseok_g10_scope_correction_preview_v3()", []] as const,
      ["select public.cutover_simseok_g10_scope_correction_preview_v3()", []] as const,
    ]) {
      await expect(database.query(query[0], [...query[1]])).rejects.toThrow(
        /permission denied/u,
      );
    }
    await database.exec("reset role;");
  });

  it("두 파일 중 하나라도 변조되면 신규 데이터가 하나도 남지 않는다", async () => {
    const tampered = [...newQuestionPackageTexts];
    tampered[1] = tampered[1]!.replace("condition", "tampered-condition");
    await expect(
      stageCorrection(database, newExamPackageTexts, tampered),
    ).rejects.toThrow(/package_file_hash_mismatch/u);

    const remaining = await database.query<{
      dataset_count: number;
      release_count: number;
    }>(`
      select
        (select count(*)::integer from public.vocab_datasets
          where dataset_key in (
            'simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1',
            'simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1'
          )) as dataset_count,
        (select count(*)::integer
          from word_index.app_canonical_question_preview_release
          where release_profile = 'simseok_g10_scope_correction_v3')
          as release_count;
    `);
    expect(remaining.rows[0]).toEqual({ dataset_count: 0, release_count: 0 });
  }, 30_000);

  it("신규 1·2과를 숨김 상태로 넣고 동일 stage 재실행은 무변경이다", async () => {
    const first = await stageCorrection(
      database,
      newExamPackageTexts,
      newQuestionPackageTexts,
    );
    expect(first.rows[0]!.result).toMatchObject({
      status: "staged",
      oldReferenceCount: 0,
      correctedOccurrenceCount: 222,
      correctedItemCount: 245,
      correctedExpandedCount: 249,
      idempotent: false,
    });

    const before = await database.query<{
      hidden_count: number;
      timestamp_binding: string;
    }>(`
      select
        count(*) filter (
          where dataset.status = 'pending_review'
            and not dataset.is_active
            and not catalog.is_assignable
            and exam_release.status = 'active'
            and question_release.status = 'loading'
        )::integer as hidden_count,
        string_agg(
          question_release.release_id::text || ':' ||
          question_release.created_at_utc::text,
          ',' order by dataset.dataset_key
        ) as timestamp_binding
      from public.vocab_datasets dataset
      join public.vocab_dataset_catalog catalog on catalog.dataset_id = dataset.id
      join word_index.app_exam_use_release exam_release
        on exam_release.dataset_id = dataset.id
      join word_index.app_canonical_question_preview_release question_release
        on question_release.dataset_id = dataset.id
      where dataset.dataset_key in (
        'simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1',
        'simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1'
      );
    `);
    expect(before.rows[0]!.hidden_count).toBe(2);

    const second = await stageCorrection(
      database,
      newExamPackageTexts,
      newQuestionPackageTexts,
    );
    const after = await database.query<{ timestamp_binding: string }>(`
      select string_agg(
        question_release.release_id::text || ':' ||
        question_release.created_at_utc::text,
        ',' order by dataset.dataset_key
      ) as timestamp_binding
      from public.vocab_datasets dataset
      join word_index.app_canonical_question_preview_release question_release
        on question_release.dataset_id = dataset.id
      where dataset.dataset_key in (
        'simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1',
        'simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1'
      );
    `);
    expect(second.rows[0]!.result).toMatchObject({
      status: "staged",
      idempotent: true,
    });
    expect(after.rows[0]!.timestamp_binding).toBe(
      before.rows[0]!.timestamp_binding,
    );
  }, 45_000);

  it("기존 3·4과에 학생 참조가 하나라도 있으면 컷오버 전체를 거부한다", async () => {
    const oldDataset = await database.query<{ id: string }>(`
      select id from public.vocab_datasets
      where dataset_key =
        'simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1';
    `);
    const userId = "00000000-0000-4000-8000-000000000123";
    await database.exec("begin;");
    try {
      await database.query("insert into auth.users(id) values ($1)", [userId]);
      await database.query(
        `insert into public.students(display_name, created_by, current_vocab_dataset_id)
         values ('범위 정정 롤백 검사', $1, $2)`,
        [userId, oldDataset.rows[0]!.id],
      );
      await assumeRole(database, "service_role");
      await expect(
        database.query(
          "select public.cutover_simseok_g10_scope_correction_preview_v3()",
        ),
      ).rejects.toThrow(/old_dataset_references_exist:[1-9][0-9]*/u);
    } finally {
      await database.exec("rollback;");
      await database.exec("reset role;");
    }

    const unchanged = await database.query<{
      old_active_count: number;
      new_hidden_count: number;
    }>(`
      select
        count(*) filter (
          where (
            dataset.dataset_key like '%-l3-2026-sem2-v1'
            or dataset.dataset_key like '%-l4-2026-sem2-v1'
          ) and dataset.status = 'ready' and dataset.is_active
            and catalog.is_assignable
        )::integer as old_active_count,
        count(*) filter (
          where (
            dataset.dataset_key like '%-l1-2026-sem2-v1'
            or dataset.dataset_key like '%-l2-2026-sem2-v1'
          ) and dataset.status = 'pending_review'
            and not dataset.is_active and not catalog.is_assignable
        )::integer
          as new_hidden_count
      from public.vocab_datasets dataset
      join public.vocab_dataset_catalog catalog on catalog.dataset_id = dataset.id
      where dataset.dataset_key like 'simseok-g10-common-english2-ohseonyeong-l%';
    `);
    expect(unchanged.rows[0]).toEqual({
      old_active_count: 2,
      new_hidden_count: 2,
    });
  });

  it("참조 0건이면 기존 3·4과를 보존 퇴역하고 신규 1·2과를 한 번에 활성화한다", async () => {
    await assumeRole(database, "service_role");
    const cutover = await database.query<{ result: Record<string, unknown> }>(
      "select public.cutover_simseok_g10_scope_correction_preview_v3() as result",
    );
    await database.exec("reset role;");
    expect(cutover.rows[0]!.result).toMatchObject({
      status: "active",
      idempotent: false,
      oldReferenceCount: 0,
      activeDatasetCount: 6,
      activeOccurrenceCount: 1509,
      activeItemCount: 1766,
      activeExpandedCount: 1771,
      activeDefinitionCount: 840,
      activeExampleCount: 926,
    });

    const totals = await database.query<{
      preserved_dataset_count: number;
      preserved_unit_count: number;
      preserved_occurrence_count: number;
      preserved_question_count: number;
      active_dataset_count: number;
      active_unit_count: number;
      active_occurrence_count: number;
      active_item_count: number;
      active_expanded_count: number;
      active_definition_count: number;
      active_example_count: number;
      retired_old_count: number;
    }>(`
      select
        (select count(*)::integer from public.vocab_datasets
          where dataset_key like 'simseok-%') as preserved_dataset_count,
        (select count(*)::integer from public.vocab_units unit
          join public.vocab_datasets dataset on dataset.id = unit.dataset_id
          where dataset.dataset_key like 'simseok-%') as preserved_unit_count,
        (select count(*)::integer from word_index.app_exam_use_occurrence occurrence
          join word_index.app_exam_use_release release
            on release.release_id = occurrence.release_id
          where release.dataset_key like 'simseok-%') as preserved_occurrence_count,
        (select count(*)::integer
          from word_index.app_canonical_question_preview_item item
          join word_index.app_canonical_question_preview_release release
            on release.release_id = item.release_id
          where release.release_profile in (
            'simseok_sem2_combined_v2',
            'simseok_g10_scope_correction_v3'
          )) as preserved_question_count,
        (select count(*)::integer from public.vocab_datasets dataset
          join public.vocab_dataset_catalog catalog on catalog.dataset_id = dataset.id
          where dataset.dataset_key like 'simseok-%' and dataset.status = 'ready'
            and dataset.is_active and catalog.is_assignable) as active_dataset_count,
        (select count(*)::integer from public.vocab_units unit
          join public.vocab_datasets dataset on dataset.id = unit.dataset_id
          join public.vocab_dataset_catalog catalog on catalog.dataset_id = dataset.id
          where dataset.dataset_key like 'simseok-%' and dataset.status = 'ready'
            and dataset.is_active and catalog.is_assignable) as active_unit_count,
        (select count(*)::integer from word_index.app_exam_use_occurrence occurrence
          join word_index.app_exam_use_release release
            on release.release_id = occurrence.release_id and release.status = 'active'
          join public.vocab_datasets dataset on dataset.id = release.dataset_id
          join public.vocab_dataset_catalog catalog on catalog.dataset_id = dataset.id
          where dataset.dataset_key like 'simseok-%' and dataset.status = 'ready'
            and dataset.is_active and catalog.is_assignable) as active_occurrence_count,
        (select count(distinct item.question_item_id)::integer
          from word_index.app_canonical_question_preview_item item
          join word_index.app_canonical_question_preview_release release
            on release.release_id = item.release_id and release.status = 'active'
          join public.vocab_datasets dataset on dataset.id = release.dataset_id
          join public.vocab_dataset_catalog catalog on catalog.dataset_id = dataset.id
          where dataset.dataset_key like 'simseok-%' and dataset.status = 'ready'
            and dataset.is_active and catalog.is_assignable) as active_item_count,
        (select count(*)::integer
          from word_index.app_canonical_question_preview_item item
          join word_index.app_canonical_question_preview_release release
            on release.release_id = item.release_id and release.status = 'active'
          join public.vocab_datasets dataset on dataset.id = release.dataset_id
          join public.vocab_dataset_catalog catalog on catalog.dataset_id = dataset.id
          where dataset.dataset_key like 'simseok-%' and dataset.status = 'ready'
            and dataset.is_active and catalog.is_assignable) as active_expanded_count,
        (select count(distinct item.question_item_id)::integer
          from word_index.app_canonical_question_preview_item item
          join word_index.app_canonical_question_preview_release release
            on release.release_id = item.release_id and release.status = 'active'
          join public.vocab_datasets dataset on dataset.id = release.dataset_id
          join public.vocab_dataset_catalog catalog on catalog.dataset_id = dataset.id
          where dataset.dataset_key like 'simseok-%' and dataset.status = 'ready'
            and dataset.is_active and catalog.is_assignable
            and item.quiz_mode = 'canonical_definition_to_headword')
          as active_definition_count,
        (select count(distinct item.question_item_id)::integer
          from word_index.app_canonical_question_preview_item item
          join word_index.app_canonical_question_preview_release release
            on release.release_id = item.release_id and release.status = 'active'
          join public.vocab_datasets dataset on dataset.id = release.dataset_id
          join public.vocab_dataset_catalog catalog on catalog.dataset_id = dataset.id
          where dataset.dataset_key like 'simseok-%' and dataset.status = 'ready'
            and dataset.is_active and catalog.is_assignable
            and item.quiz_mode = 'canonical_example_to_headword')
          as active_example_count,
        (select count(*)::integer from public.vocab_datasets dataset
          join public.vocab_dataset_catalog catalog on catalog.dataset_id = dataset.id
          where dataset.dataset_key in (
            'simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1',
            'simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1'
          ) and dataset.status = 'retired' and not dataset.is_active
            and not catalog.is_assignable) as retired_old_count;
    `);
    expect(totals.rows[0]).toEqual({
      preserved_dataset_count: 8,
      preserved_unit_count: 100,
      preserved_occurrence_count: 1806,
      preserved_question_count: 2245,
      active_dataset_count: 6,
      active_unit_count: 84,
      active_occurrence_count: 1509,
      active_item_count: 1766,
      active_expanded_count: 1771,
      active_definition_count: 840,
      active_example_count: 926,
      retired_old_count: 2,
    });
  }, 45_000);

  it("활성화 뒤 stage와 cutover를 다시 실행해도 상태·행 수가 변하지 않는다", async () => {
    const restage = await stageCorrection(
      database,
      newExamPackageTexts,
      newQuestionPackageTexts,
    );
    expect(restage.rows[0]!.result).toMatchObject({
      status: "active",
      idempotent: true,
    });
    await assumeRole(database, "service_role");
    const recutover = await database.query<{ result: Record<string, unknown> }>(
      "select public.cutover_simseok_g10_scope_correction_preview_v3() as result",
    );
    await database.exec("reset role;");
    expect(recutover.rows[0]!.result).toMatchObject({
      status: "active",
      idempotent: true,
      activeDatasetCount: 6,
      activeOccurrenceCount: 1509,
      activeExpandedCount: 1771,
    });
  }, 45_000);
});
