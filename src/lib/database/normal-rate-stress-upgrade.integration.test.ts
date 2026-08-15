import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  "supabase/migrations/20260815116000_allow_atomic_normal_rate_stress_upgrade.sql",
);

const sourceVersion =
  "fc98d9cf6d0a688328234605377d159d50bbc51ba1c689852d657ffc95c77d08";
const oldVersion =
  "deff871f4828da91051cfb72eb15249cbbf0ab7f52d1df7f24db909a97813b3c";
const newVersion =
  "94239160f95be4173ff3cb6b507f2244dbe56a80419b7779338af1e2494c8316";

describe("normal-rate stress package upgrade", () => {
  it("replaces exactly one complete old generation and rolls deletion back on failure", async () => {
    const database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema private;

      create table public.vocab_rule_derived_korean_pronunciations (
        id integer primary key,
        dataset_key text not null,
        source_exam_package_version text not null,
        package_version text not null,
        engine_version text not null,
        source_expression_manifest_sha256 text not null,
        source_word_manifest_sha256 text not null,
        source_webster_repair_sha256 text not null,
        display_enabled boolean not null
      );
      insert into public.vocab_rule_derived_korean_pronunciations
      select
        value,
        'g12-long-reading-2025-exam-scope-v1',
        '${sourceVersion}',
        '${oldVersion}',
        'cmudict-hangul-nucleus-align-v3',
        '770a163e8f7abf348bae75920131c9ca24a27b6017eda363626ca59e7621132e',
        'c3de9146a3449a4694e5e2367b3db07ed05a4522c35616b430f5bc82f48b4714',
        'd57a4ba65a7bb7cfd69f68201512ae16e9b6a8ac94a31564c6f73bb8c367841b',
        true
      from generate_series(1, 582) as value;

      create function private.import_rule_derived_korean_pronunciation_package_v2(
        p_package jsonb
      ) returns jsonb language plpgsql security definer set search_path = '' as $$
      begin
        if p_package ->> 'fail' = 'true' then
          raise exception 'simulated_import_failure';
        end if;
        if exists (
          select 1
          from public.vocab_rule_derived_korean_pronunciations
          where dataset_key = 'g12-long-reading-2025-exam-scope-v1'
        ) then
          raise exception 'old_generation_not_removed';
        end if;
        insert into public.vocab_rule_derived_korean_pronunciations
        select
          value,
          'g12-long-reading-2025-exam-scope-v1',
          '${sourceVersion}',
          '${newVersion}',
          'cmudict-hangul-nucleus-align-v3',
          '194ef0847d052b95f8f34e45623e4a484ed7b49bed6288f152eb8fdef18b5a74',
          'bf01d285b7420b117db2e65a96502886a921b7ec14f4bcda167bb7c78c6f2412',
          'd57a4ba65a7bb7cfd69f68201512ae16e9b6a8ac94a31564c6f73bb8c367841b',
          true
        from generate_series(1, 582) as value;
        return jsonb_build_object('status', 'ok');
      end;
      $$;
      create function public.import_rule_derived_korean_pronunciation_package_v2(
        p_package jsonb
      ) returns jsonb language sql security definer set search_path = '' as $$
        select private.import_rule_derived_korean_pronunciation_package_v2(
          p_package
        );
      $$;
    `);

    await database.exec(await readFile(migrationPath, "utf8"));

    const packageValue = {
      schema_version: "rule-derived-korean-pronunciation-batch-v1",
      package_id: "g12-long-reading-2025-rule-derived-stress-v3",
      target_environment: "staging",
      dataset_key: "g12-long-reading-2025-exam-scope-v1",
      source_exam_package_version: sourceVersion,
      source_expression_manifest_sha256:
        "194ef0847d052b95f8f34e45623e4a484ed7b49bed6288f152eb8fdef18b5a74",
      source_word_manifest_sha256:
        "bf01d285b7420b117db2e65a96502886a921b7ec14f4bcda167bb7c78c6f2412",
      source_webster_repair_sha256:
        "d57a4ba65a7bb7cfd69f68201512ae16e9b6a8ac94a31564c6f73bb8c367841b",
      package_version: newVersion,
    };

    await expect(
      database.query(`
        select public.import_rule_derived_korean_pronunciation_package_v2(
          '${JSON.stringify({ ...packageValue, fail: true })}'::jsonb
        )
      `),
    ).rejects.toThrow("simulated_import_failure");
    const afterFailure = await database.query<{ count: number }>(`
      select count(*)::integer as count
      from public.vocab_rule_derived_korean_pronunciations
      where package_version = '${oldVersion}'
    `);
    expect(afterFailure.rows).toEqual([{ count: 582 }]);

    const imported = await database.query<{ status: string }>(`
      select public.import_rule_derived_korean_pronunciation_package_v2(
        '${JSON.stringify(packageValue)}'::jsonb
      ) ->> 'status' as status
    `);
    expect(imported.rows).toEqual([{ status: "ok" }]);

    const generations = await database.query<{
      count: number;
      package_version: string;
    }>(`
      select package_version, count(*)::integer as count
      from public.vocab_rule_derived_korean_pronunciations
      group by package_version
    `);
    expect(generations.rows).toEqual([
      { package_version: newVersion, count: 582 },
    ]);

    const privileges = await database.query<{
      anon_allowed: boolean;
      service_allowed: boolean;
    }>(`
      select
        has_function_privilege(
          'anon',
          'public.import_rule_derived_korean_pronunciation_package_v2(jsonb)',
          'execute'
        ) as anon_allowed,
        has_function_privilege(
          'service_role',
          'public.import_rule_derived_korean_pronunciation_package_v2(jsonb)',
          'execute'
        ) as service_allowed
    `);
    expect(privileges.rows).toEqual([
      { anon_allowed: false, service_allowed: true },
    ]);
  }, 15_000);
});
