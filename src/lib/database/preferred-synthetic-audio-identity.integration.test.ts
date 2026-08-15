import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  "supabase/migrations/20260815115500_prefer_normal_rate_synthetic_audio_identity.sql",
);

describe("normal-rate synthetic audio identity selection", () => {
  it("selects the 1.0 profile deterministically while preserving old assets", async () => {
    const database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema private;
      create schema word_index;

      create table word_index.app_exam_use_release (
        release_id text primary key
      );
      create table word_index.app_exam_use_occurrence (
        release_id text not null,
        vocab_entry_id bigint not null,
        dictionary_id text not null
      );
      create table public.vocab_synthetic_audio_assets (
        asset_id text primary key,
        dictionary_id text not null,
        audio_sha256 text not null,
        storage_verified boolean not null,
        playback_enabled boolean not null
      );
      create table public.vocab_synthetic_audio_bindings (
        release_id text not null,
        vocab_entry_id bigint not null,
        dictionary_id text not null,
        profile_id text not null,
        asset_id text not null
      );

      create function private.import_rule_derived_korean_pronunciation_package_v2(
        p_package jsonb
      ) returns jsonb language plpgsql security definer set search_path = '' as $$
      declare
        v_asset_id text;
      begin
        select asset.asset_id into v_asset_id
        from word_index.app_exam_use_release as release
        left join word_index.app_exam_use_occurrence as occurrence
          on occurrence.release_id = release.release_id
          and occurrence.dictionary_id = p_package ->> 'dictionary_id'
        left join public.vocab_synthetic_audio_bindings as binding
          on binding.release_id = release.release_id
          and binding.vocab_entry_id = occurrence.vocab_entry_id
          and binding.dictionary_id = occurrence.dictionary_id
        left join public.vocab_synthetic_audio_assets as asset
          on asset.asset_id = binding.asset_id
          and asset.dictionary_id = occurrence.dictionary_id
          and asset.storage_verified
          and asset.playback_enabled
        limit 1;
        return jsonb_build_object('assetId', v_asset_id);
      end;
      $$;
      create function public.import_rule_derived_korean_pronunciation_package_v2(
        p_package jsonb
      ) returns jsonb language sql security definer set search_path = '' as $$
        select private.import_rule_derived_korean_pronunciation_package_v2(
          p_package
        );
      $$;
      grant execute on function
        private.import_rule_derived_korean_pronunciation_package_v2(jsonb)
        to service_role;

      insert into word_index.app_exam_use_release values ('release:test');
      insert into word_index.app_exam_use_occurrence values
        ('release:test', 1, 'expression:test'),
        ('release:test', 2, 'word:test');
      insert into public.vocab_synthetic_audio_assets values
        ('synthetic:expression-old', 'expression:test', '${"a".repeat(64)}', true, true),
        ('synthetic:expression-new', 'expression:test', '${"b".repeat(64)}', true, true),
        ('synthetic:word-old', 'word:test', '${"c".repeat(64)}', true, true),
        ('synthetic:word-new', 'word:test', '${"d".repeat(64)}', true, true);
      insert into public.vocab_synthetic_audio_bindings values
        ('release:test', 1, 'expression:test', 'profile:5b6efb0ecc8f4702', 'synthetic:expression-old'),
        ('release:test', 1, 'expression:test', 'profile:286866721f7f4ee8', 'synthetic:expression-new'),
        ('release:test', 2, 'word:test', 'profile:75ca7f418d66e6ab', 'synthetic:word-old'),
        ('release:test', 2, 'word:test', 'profile:1a77d56d47e26013', 'synthetic:word-new');
    `);

    await database.exec(await readFile(migrationPath, "utf8"));

    const selected = await database.query<{ asset_id: string }>(`
      select public.import_rule_derived_korean_pronunciation_package_v2(
        '{"dictionary_id":"expression:test"}'::jsonb
      ) ->> 'assetId' as asset_id
      union all
      select public.import_rule_derived_korean_pronunciation_package_v2(
        '{"dictionary_id":"word:test"}'::jsonb
      ) ->> 'assetId' as asset_id
    `);
    expect(selected.rows).toEqual([
      { asset_id: "synthetic:expression-new" },
      { asset_id: "synthetic:word-new" },
    ]);

    const assets = await database.query<{ asset_id: string }>(`
      select asset_id
      from public.vocab_synthetic_audio_assets
      order by asset_id
    `);
    expect(assets.rows).toHaveLength(4);

    const privileges = await database.query<{
      private_allowed: boolean;
      public_allowed: boolean;
    }>(`
      select
        has_function_privilege(
          'service_role',
          'private.import_rule_derived_korean_pronunciation_package_v2(jsonb)',
          'execute'
        ) as private_allowed,
        has_function_privilege(
          'service_role',
          'public.import_rule_derived_korean_pronunciation_package_v2(jsonb)',
          'execute'
        ) as public_allowed
    `);
    expect(privileges.rows).toEqual([
      { private_allowed: false, public_allowed: true },
    ]);
  });
});
