import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const rollback = (name: string) =>
  readFile(path.resolve("supabase/rollback", name), "utf8");

describe("normal-rate rollback chain", () => {
  it("keeps the null-safe profile guards for the following profile rollback", async () => {
    const database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema private;
      create function private.import_vocab_synthetic_audio_package_v1(
        p_package jsonb
      ) returns jsonb language plpgsql as $$
      begin
        if (p_package ->> 'profile_id') is null or (p_package ->> 'profile_id') not in ('profile:5b6efb0ecc8f4702', 'profile:286866721f7f4ee8')
        then raise exception 'invalid'; end if;
        return p_package;
      end;
      $$;
      create function private.import_vocab_synthetic_word_audio_package_v1(
        p_package jsonb
      ) returns jsonb language plpgsql as $$
      begin
        if (p_package ->> 'profile_id') is null or (p_package ->> 'profile_id') not in ('profile:75ca7f418d66e6ab', 'profile:1a77d56d47e26013')
        then raise exception 'invalid'; end if;
        return p_package;
      end;
      $$;
      create function public.import_vocab_synthetic_audio_package_v1(
        p_package jsonb
      ) returns jsonb language sql as $$
        select private.import_vocab_synthetic_audio_package_v1(p_package)
      $$;
      create function public.import_vocab_synthetic_word_audio_package_v1(
        p_package jsonb
      ) returns jsonb language sql as $$
        select private.import_vocab_synthetic_word_audio_package_v1(p_package)
      $$;
    `);

    await database.exec(
      await rollback(
        "20260815116500_harden_normal_rate_audio_selection.sql",
      ),
    );
    const definitions = await database.query<{
      expression_definition: string;
      word_definition: string;
    }>(`
      select
        pg_get_functiondef(
          'private.import_vocab_synthetic_audio_package_v1(jsonb)'::regprocedure
        ) as expression_definition,
        pg_get_functiondef(
          'private.import_vocab_synthetic_word_audio_package_v1(jsonb)'::regprocedure
        ) as word_definition
    `);
    expect(definitions.rows[0].expression_definition.toLowerCase()).toContain(
      "(p_package ->> 'profile_id') is null",
    );
    expect(definitions.rows[0].word_definition.toLowerCase()).toContain(
      "(p_package ->> 'profile_id') is null",
    );
    await database.close();
  });

  it("restores the staging project guard when the atomic upgrade is removed", async () => {
    const database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema private;
      create table public.vocab_rule_derived_korean_pronunciations (
        package_version text not null
      );
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
      create function private.import_rule_derived_korean_pronunciation_package_v2(
        p_package jsonb
      ) returns jsonb language sql as $$ select p_package $$;
      create function public.import_rule_derived_korean_pronunciation_package_v2(
        p_package jsonb
      ) returns jsonb language sql as $$
        select private.import_rule_derived_korean_pronunciation_package_v2(
          p_package
        )
      $$;
    `);

    await database.exec(
      await rollback(
        "20260815116000_allow_atomic_normal_rate_stress_upgrade.sql",
      ),
    );
    await database.exec(
      `set request.jwt.claims =
        '{"role":"service_role","ref":"xdxhswjgksukjmpbzqgz"}'`,
    );
    await expect(
      database.query(
        "select public.import_rule_derived_korean_pronunciation_package_v2('{}'::jsonb)",
      ),
    ).rejects.toThrow("staging_pronunciation_import_project_mismatch");

    await database.exec(
      `set request.jwt.claims =
        '{"role":"service_role","ref":"wojxpruvbjzbhrpmsbuy"}'`,
    );
    const imported = await database.query<{ value: Record<string, never> }>(`
      select public.import_rule_derived_korean_pronunciation_package_v2(
        '{}'::jsonb
      ) as value
    `);
    expect(imported.rows).toEqual([{ value: {} }]);
    await database.close();
  });
});
