import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SIMSEOK_COMBINED_QUESTION_EXPECTED_SETS } from
  "@/lib/vocab/simseok-sem2-question-preview-import-contract";
import {
  SIMSEOK_SEM2_EXPECTED_SETS,
  SIMSEOK_SEM2_PREVIEW_PROJECT_REF,
} from "@/lib/vocab/simseok-sem2-preview-import-contract";

const examHandoffDirectory = path.resolve(
  "../..",
  "영어/00_자료투입함/[시안] 제작중/심석고_2학기_단어시험/v2_최신범위/02_앱전달묶음",
);
const questionHandoffDirectory = path.resolve(
  "../..",
  "영어/00_자료투입함/[시안] 제작중/심석고_2학기_단어시험/v2_최신범위/03_통합문항_앱전달묶음",
);
const hasLocalHandoff =
  fs.existsSync(path.join(examHandoffDirectory, "app-handoff-manifest.json")) &&
  fs.existsSync(
    path.join(questionHandoffDirectory, "combined-question-handoff-manifest.json"),
  );
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
      '{"role":"${role}","ref":"${SIMSEOK_SEM2_PREVIEW_PROJECT_REF}"}',
      false
    );
  `);
}

const describeWithHandoff = hasLocalHandoff ? describe.sequential : describe.skip;

describeWithHandoff("심석고 통합 영영풀이·예문 Preview DB 가져오기", () => {
  let database: PGlite;
  let examPackageTexts: string[];
  let questionPackageTexts: string[];

  beforeAll(async () => {
    database = await createFinalSchemaDatabase();
    examPackageTexts = SIMSEOK_SEM2_EXPECTED_SETS.map((item) =>
      fs.readFileSync(path.join(examHandoffDirectory, item.packagePath), "utf8"),
    );
    questionPackageTexts = SIMSEOK_COMBINED_QUESTION_EXPECTED_SETS.map((item) =>
      fs.readFileSync(path.join(questionHandoffDirectory, item.packagePath), "utf8"),
    );
    await assumeRole(database, "service_role");
    await database.query(
      "select public.import_simseok_sem2_preview_bundle_v1($1::jsonb)",
      [JSON.stringify(examPackageTexts)],
    );
    await database.exec("reset role;");
  }, 90_000);

  afterAll(async () => {
    await database?.close();
  });

  it("여섯 파일 중 하나라도 변조되면 어떤 question release도 남기지 않는다", async () => {
    const tampered = [...questionPackageTexts];
    tampered[5] = tampered[5]!.replace(
      "simseok-sem2-combined-preview-v2",
      "simseok-sem2-combined-preview-v2-tampered",
    );
    await assumeRole(database, "service_role");
    await expect(
      database.query(
        "select public.import_simseok_sem2_combined_question_preview_bundle_v2($1::jsonb)",
        [JSON.stringify(tampered)],
      ),
    ).rejects.toThrow(/package_file_hash_mismatch/u);
    await database.exec("reset role;");

    const remaining = await database.query<{ release_count: number }>(`
      select count(*)::integer as release_count
      from word_index.app_canonical_question_preview_release
      where release_profile = 'simseok_sem2_combined_v2';
    `);
    expect(remaining.rows[0]!.release_count).toBe(0);
  }, 30_000);

  it("1995개 문항을 1996개 occurrence에 결속하고 재실행은 완전한 no-op이다", async () => {
    await assumeRole(database, "service_role");
    const first = await database.query<{
      result: {
        status: string;
        datasetCount: number;
        itemCount: number;
        expandedCount: number;
        definitionCount: number;
        exampleCount: number;
        targetEnvironment: string;
        manifestContentHash: string;
        datasets: Array<{ idempotent: boolean }>;
      };
    }>(
      "select public.import_simseok_sem2_combined_question_preview_bundle_v2($1::jsonb) as result",
      [JSON.stringify(questionPackageTexts)],
    );
    await database.exec("reset role;");

    expect(first.rows[0]!.result).toMatchObject({
      status: "active",
      datasetCount: 6,
      itemCount: 1995,
      expandedCount: 1996,
      definitionCount: 942,
      exampleCount: 1053,
      targetEnvironment: "preview",
      manifestContentHash:
        "4482b3379b9f4641d18136ccfab25fa6db206763824813a61aebf68621a8e6ff",
    });
    expect(first.rows[0]!.result.datasets.every((item) => !item.idempotent)).toBe(
      true,
    );

    const before = await database.query<{
      release_count: number;
      expanded_count: number;
      item_count: number;
      definition_count: number;
      example_count: number;
      exact_binding_count: number;
      timestamp_binding: string;
    }>(`
      select
        count(distinct release.release_id)::integer as release_count,
        count(*)::integer as expanded_count,
        count(distinct item.question_item_id)::integer as item_count,
        count(distinct item.question_item_id) filter (
          where item.quiz_mode = 'canonical_definition_to_headword'
        )::integer as definition_count,
        count(distinct item.question_item_id) filter (
          where item.quiz_mode = 'canonical_example_to_headword'
        )::integer as example_count,
        count(*) filter (
          where item.source_occurrence_content_hash =
              occurrence.package_entry_content_hash
            and item.review_input_sha256 =
              item.source_question_content_hash
            and item.review_audit_sha256 = item.question_item_sha256
            and item.review_solver_sha256 = item.choice_pool_content_hash
            and item.provenance ->> 'reviewLevel' =
              'source_or_user_authorized_webster_raw_preview_temporary_v1'
            and item.provenance -> 'targetPosSignature' =
              to_jsonb(item.target_pos_signature)
            and item.provenance #>>
              '{legacyReviewHashMapping,reviewInputSha256}' =
              'source_question_content_hash'
        )::integer as exact_binding_count,
        (
          select string_agg(
            snapshot.release_id::text || ':' ||
              snapshot.created_at_utc::text || ':' ||
              snapshot.activated_at_utc::text,
            ',' order by snapshot.release_id
          )
          from word_index.app_canonical_question_preview_release as snapshot
          where snapshot.release_profile = 'simseok_sem2_combined_v2'
        ) as timestamp_binding
      from word_index.app_canonical_question_preview_release as release
      join word_index.app_canonical_question_preview_item as item
        on item.release_id = release.release_id
      join word_index.app_exam_use_occurrence as occurrence
        on occurrence.release_id = item.exam_use_release_id
       and occurrence.vocab_entry_id = item.vocab_entry_id
      where release.release_profile = 'simseok_sem2_combined_v2'
        and release.status = 'active'
        and release.target_environment = 'preview'
        and release.source_shadow_only
        and release.preview_apply_allowed
        and not release.canonical_approved
        and not release.release_allowed
        and not release.production_apply_allowed
        and release.handoff_manifest_file_sha256 =
          '625c212c1f2a695bd0878bed9e5ea28bd50338b2692fe055e317a78df51a8ab3'
        and release.independent_review_ledger_sha256 =
          'ccb1a8c22424c4b7f11b4eb243f2019200bda4709017b0e6f3b82fa45cbd2910'
        and release.generator_file_sha256 =
          'a26d8d4e24455b9c41b033a0e84b604486dca1f586acad147bdd259dd5a2ff95';
    `);
    expect(before.rows[0]).toMatchObject({
      release_count: 6,
      expanded_count: 1996,
      item_count: 1995,
      definition_count: 942,
      example_count: 1053,
      exact_binding_count: 1996,
    });

    await database.exec("select pg_sleep(0.01);");
    await assumeRole(database, "service_role");
    const second = await database.query<typeof first.rows[number]>(
      "select public.import_simseok_sem2_combined_question_preview_bundle_v2($1::jsonb) as result",
      [JSON.stringify(questionPackageTexts)],
    );
    await database.exec("reset role;");
    const after = await database.query<{ timestamp_binding: string }>(`
      select string_agg(
        release_id::text || ':' || created_at_utc::text || ':' ||
          activated_at_utc::text,
        ',' order by release_id
      ) as timestamp_binding
      from word_index.app_canonical_question_preview_release
      where release_profile = 'simseok_sem2_combined_v2';
    `);
    expect(second.rows[0]!.result.datasets.every((item) => item.idempotent)).toBe(
      true,
    );
    expect(after.rows[0]!.timestamp_binding).toBe(
      before.rows[0]!.timestamp_binding,
    );
  }, 45_000);

  it("authenticated 역할은 가져오기 RPC를 실행할 수 없다", async () => {
    await assumeRole(database, "authenticated");
    await expect(
      database.query(
        "select public.import_simseok_sem2_combined_question_preview_bundle_v2($1::jsonb)",
        [JSON.stringify(questionPackageTexts)],
      ),
    ).rejects.toThrow(/permission denied/u);
    await database.exec("reset role;");
  });
});
