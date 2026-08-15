import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  "supabase/migrations/20260815117000_harden_and_upgrade_production_normal_rate_stress.sql",
);

const sourceVersion =
  "fc98d9cf6d0a688328234605377d159d50bbc51ba1c689852d657ffc95c77d08";
const oldProductionVersion =
  "d12dfd8924d32bd1001675196747b16b3ad875959b09e67e2870f30832739405";
const newProductionVersion =
  "8c546c01aa89ad08bf9128de4db41385fee71865fb7e4a652cc41fd1073b3d09";

describe("production normal-rate stress package upgrade", () => {
  it("keeps project routing and atomically replaces the complete production generation", async () => {
    const database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema private;

      create function private.request_supabase_project_ref_v1()
      returns text language sql stable set search_path = '' as $$
        select nullif(
          coalesce(
            nullif(current_setting('request.jwt.claims', true), '')::jsonb,
            '{}'::jsonb
          ) ->> 'ref',
          ''
        )
      $$;

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
        '${oldProductionVersion}',
        'cmudict-hangul-nucleus-align-v3',
        '770a163e8f7abf348bae75920131c9ca24a27b6017eda363626ca59e7621132e',
        'c3de9146a3449a4694e5e2367b3db07ed05a4522c35616b430f5bc82f48b4714',
        'd57a4ba65a7bb7cfd69f68201512ae16e9b6a8ac94a31564c6f73bb8c367841b',
        true
      from generate_series(1, 582) as value;

      create function private.import_rule_derived_korean_pronunciation_package_v2(
        p_package jsonb
      ) returns jsonb language plpgsql security definer set search_path = '' as $$
      declare
        v_package_version text := p_package ->> 'package_version';
        v_expression_hash text :=
          p_package ->> 'source_expression_manifest_sha256';
        v_word_hash text := p_package ->> 'source_word_manifest_sha256';
      begin
        if p_package ->> 'fail' = 'true' then
          raise exception 'simulated_import_failure';
        end if;
        if (
          select count(*) = 582
            and bool_and(package_version = v_package_version)
          from public.vocab_rule_derived_korean_pronunciations
        ) then
          return jsonb_build_object('status', 'idempotent');
        end if;
        if exists (
          select 1 from public.vocab_rule_derived_korean_pronunciations
        ) then
          raise exception 'old_generation_not_removed';
        end if;
        insert into public.vocab_rule_derived_korean_pronunciations
        select
          value,
          'g12-long-reading-2025-exam-scope-v1',
          '${sourceVersion}',
          v_package_version,
          'cmudict-hangul-nucleus-align-v3',
          v_expression_hash,
          v_word_hash,
          'd57a4ba65a7bb7cfd69f68201512ae16e9b6a8ac94a31564c6f73bb8c367841b',
          true
        from generate_series(1, 582) as value;
        return jsonb_build_object('status', 'ok');
      end;
      $$;

      create function private.import_rule_derived_korean_pronunciation_package_production_v3(
        p_package jsonb
      ) returns jsonb language plpgsql security definer set search_path = '' as $$
      declare
        v_import_package jsonb;
      begin
        v_import_package := p_package || jsonb_build_object(
          'package_id', 'g12-long-reading-2025-rule-derived-stress-v3',
          'target_environment', 'staging'
        );
        return private.import_rule_derived_korean_pronunciation_package_v2(
          v_import_package
        );
      end;
      $$;

      create function public.import_rule_derived_korean_pronunciation_package_v2(
        p_package jsonb
      ) returns jsonb language sql security definer set search_path = '' as $$
        select private.import_rule_derived_korean_pronunciation_package_v2(p_package)
      $$;
      create function public.import_rule_derived_korean_pronunciation_package_production_v3(
        p_package jsonb
      ) returns jsonb language sql security definer set search_path = '' as $$
        select private.import_rule_derived_korean_pronunciation_package_production_v3(
          p_package
        )
      $$;
    `);

    await database.exec(await readFile(migrationPath, "utf8"));

    const packageValue = {
      schema_version: "rule-derived-korean-pronunciation-batch-v1",
      package_id:
        "g12-long-reading-2025-rule-derived-stress-production-v3",
      target_environment: "production",
      dataset_key: "g12-long-reading-2025-exam-scope-v1",
      source_exam_package_version: sourceVersion,
      source_expression_manifest_sha256:
        "194ef0847d052b95f8f34e45623e4a484ed7b49bed6288f152eb8fdef18b5a74",
      source_word_manifest_sha256:
        "bf01d285b7420b117db2e65a96502886a921b7ec14f4bcda167bb7c78c6f2412",
      source_webster_repair_sha256:
        "d57a4ba65a7bb7cfd69f68201512ae16e9b6a8ac94a31564c6f73bb8c367841b",
      package_version: newProductionVersion,
    };

    await database.exec(
      `set request.jwt.claims =
        '{"role":"service_role","ref":"xdxhswjgksukjmpbzqgz"}'`,
    );
    await expect(
      database.query(`
        select public.import_rule_derived_korean_pronunciation_package_production_v3(
          '${JSON.stringify({ ...packageValue, fail: true })}'::jsonb
        )
      `),
    ).rejects.toThrow("simulated_import_failure");
    const afterFailure = await database.query<{ count: number }>(`
      select count(*)::integer as count
      from public.vocab_rule_derived_korean_pronunciations
      where package_version = '${oldProductionVersion}'
    `);
    expect(afterFailure.rows).toEqual([{ count: 582 }]);

    const imported = await database.query<{ status: string }>(`
      select public.import_rule_derived_korean_pronunciation_package_production_v3(
        '${JSON.stringify(packageValue)}'::jsonb
      ) ->> 'status' as status
    `);
    expect(imported.rows).toEqual([{ status: "ok" }]);

    const repeated = await database.query<{ status: string }>(`
      select public.import_rule_derived_korean_pronunciation_package_production_v3(
        '${JSON.stringify(packageValue)}'::jsonb
      ) ->> 'status' as status
    `);
    expect(repeated.rows).toEqual([{ status: "idempotent" }]);

    const oldPackageValue = {
      ...packageValue,
      source_expression_manifest_sha256:
        "770a163e8f7abf348bae75920131c9ca24a27b6017eda363626ca59e7621132e",
      source_word_manifest_sha256:
        "c3de9146a3449a4694e5e2367b3db07ed05a4522c35616b430f5bc82f48b4714",
      package_version: oldProductionVersion,
    };
    const restored = await database.query<{ status: string }>(`
      select public.import_rule_derived_korean_pronunciation_package_production_v3(
        '${JSON.stringify(oldPackageValue)}'::jsonb
      ) ->> 'status' as status
    `);
    expect(restored.rows).toEqual([{ status: "ok" }]);
    const restoredRows = await database.query<{
      count: number;
      package_version: string;
    }>(`
      select package_version, count(*)::integer as count
      from public.vocab_rule_derived_korean_pronunciations
      group by package_version
    `);
    expect(restoredRows.rows).toEqual([
      { package_version: oldProductionVersion, count: 582 },
    ]);

    await expect(
      database.query(
        "select public.import_rule_derived_korean_pronunciation_package_v2('{}'::jsonb)",
      ),
    ).rejects.toThrow("staging_pronunciation_import_project_mismatch");

    const privileges = await database.query<{
      anon_allowed: boolean;
      service_allowed: boolean;
    }>(`
      select
        has_function_privilege(
          'anon',
          'public.import_rule_derived_korean_pronunciation_package_production_v3(jsonb)',
          'execute'
        ) as anon_allowed,
        has_function_privilege(
          'service_role',
          'public.import_rule_derived_korean_pronunciation_package_production_v3(jsonb)',
          'execute'
        ) as service_allowed
    `);
    expect(privileges.rows).toEqual([
      { anon_allowed: false, service_allowed: true },
    ]);
    await database.close();
  }, 15_000);
});
