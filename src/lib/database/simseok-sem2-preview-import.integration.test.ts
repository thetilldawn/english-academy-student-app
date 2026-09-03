import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SIMSEOK_SEM2_EXPECTED_SETS,
  SIMSEOK_SEM2_PREVIEW_PROJECT_REF,
} from "@/lib/vocab/simseok-sem2-preview-import-contract";

const handoffDirectory = path.resolve(
  "../..",
  "영어/00_자료투입함/[시안] 제작중/심석고_2학기_단어시험/v2_최신범위/02_앱전달묶음",
);
const hasLocalHandoff = fs.existsSync(
  path.join(handoffDirectory, "app-handoff-manifest.json"),
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

async function assumePreviewServiceRole(database: PGlite) {
  await database.exec(`
    set role service_role;
    select set_config(
      'request.jwt.claims',
      '{"role":"service_role","ref":"${SIMSEOK_SEM2_PREVIEW_PROJECT_REF}"}',
      false
    );
  `);
}

const describeWithHandoff = hasLocalHandoff ? describe.sequential : describe.skip;

describeWithHandoff("심석고 2학기 여섯 자료 로컬 DB 가져오기", () => {
  let database: PGlite;
  let packageTexts: string[];

  beforeAll(async () => {
    database = await createFinalSchemaDatabase();
    packageTexts = SIMSEOK_SEM2_EXPECTED_SETS.map((item) =>
      fs.readFileSync(path.join(handoffDirectory, item.packagePath), "utf8"),
    );
  }, 30_000);

  afterAll(async () => {
    await database?.close();
  });

  it("1,584개를 원자적으로 넣고 같은 파일 재실행은 완전한 no-op이다", async () => {
    await assumePreviewServiceRole(database);
    const first = await database.query<{
      result: {
        datasetCount: number;
        occurrenceCount: number;
        datasets: Array<{ idempotent: boolean }>;
      };
    }>(
      "select public.import_simseok_sem2_preview_bundle_v1($1::jsonb) as result",
      [JSON.stringify(packageTexts)],
    );
    await database.exec("reset role;");
    const before = await database.query<{
      dataset_catalog_count: number;
      unit_catalog_count: number;
      occurrence_count: number;
      catalog_timestamp_binding: string;
    }>(`
      select
        (select count(*)::integer from public.vocab_dataset_catalog
          where metadata ->> 'school' = '심석고등학교') as dataset_catalog_count,
        (select count(*)::integer from public.vocab_unit_catalog
          where metadata ->> 'scopeStatus' =
            'user_directed_operational_scope_not_officially_confirmed')
          as unit_catalog_count,
        (select count(*)::integer
          from word_index.app_exam_use_occurrence as occurrence
          join word_index.app_exam_use_release as release
            on release.release_id = occurrence.release_id
          where release.dataset_key like 'simseok-%') as occurrence_count,
        (select string_agg(
          dataset_id::text || ':' || updated_at::text,
          ',' order by dataset_id
        ) from public.vocab_dataset_catalog
          where metadata ->> 'school' = '심석고등학교')
          as catalog_timestamp_binding;
    `);

    await database.exec("select pg_sleep(0.01);");
    await assumePreviewServiceRole(database);
    const second = await database.query<typeof first.rows[number]>(
      "select public.import_simseok_sem2_preview_bundle_v1($1::jsonb) as result",
      [JSON.stringify(packageTexts)],
    );
    await database.exec("reset role;");
    const after = await database.query<{
      catalog_timestamp_binding: string;
    }>(`
      select string_agg(
        dataset_id::text || ':' || updated_at::text,
        ',' order by dataset_id
      ) as catalog_timestamp_binding
      from public.vocab_dataset_catalog
      where metadata ->> 'school' = '심석고등학교';
    `);

    expect(first.rows[0]!.result).toMatchObject({
      datasetCount: 6,
      occurrenceCount: 1584,
    });
    expect(first.rows[0]!.result.datasets.every((item) => !item.idempotent)).toBe(
      true,
    );
    expect(before.rows[0]).toMatchObject({
      dataset_catalog_count: 6,
      unit_catalog_count: 88,
      occurrence_count: 1584,
    });
    expect(second.rows[0]!.result.datasets.every((item) => item.idempotent)).toBe(
      true,
    );
    expect(after.rows[0]!.catalog_timestamp_binding).toBe(
      before.rows[0]!.catalog_timestamp_binding,
    );
  }, 30_000);

  it("원문 한 글자 변조도 DB 파일 해시에서 거부한다", async () => {
    const tampered = [...packageTexts];
    tampered[0] = tampered[0]!.replace("[영어 II]", "[변조 영어 II]");
    await assumePreviewServiceRole(database);
    await expect(
      database.query(
        "select public.import_simseok_sem2_preview_bundle_v1($1::jsonb)",
        [JSON.stringify(tampered)],
      ),
    ).rejects.toThrow(/package_file_hash_mismatch/u);
    await database.exec("reset role;");
  });
});
