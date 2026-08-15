import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  "supabase/migrations/20260815114500_add_normal_rate_synthetic_audio_profiles.sql",
);
const hardeningMigrationPath = path.resolve(
  "supabase/migrations/20260815116500_harden_normal_rate_audio_selection.sql",
);

describe("normal-rate synthetic audio database migration", () => {
  it("keeps old assets, admits exact 1.0 profiles, and closes private imports", async () => {
    const database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema private;

      create table public.vocab_synthetic_audio_assets (
        asset_id text primary key,
        dictionary_id text not null,
        profile_id text not null,
        speaking_rate numeric not null,
        constraint vocab_synthetic_audio_assets_speaking_rate_check
          check (speaking_rate = 0.88)
      );
      create table public.vocab_synthetic_audio_bindings (
        binding_id bigint generated always as identity primary key,
        release_id text not null,
        vocab_entry_id bigint not null,
        profile_id text not null,
        constraint vocab_synthetic_audio_binding_release_vocab_entry_key
          unique (release_id, vocab_entry_id)
      );
      create table public.vocab_pronunciation_tts_assets_v2 (
        request_sha256 text primary key,
        storage_object_key text not null,
        profile_id text not null,
        constraint vocab_pronunciation_tts_assets_v2_check
          check (storage_object_key =
            'pronunciation/google_cloud_text_to_speech/profile-75ca7f418d66e6ab/ability-voca-etymology-2025-v1/' ||
            request_sha256 || '.mp3'),
        constraint vocab_pronunciation_tts_assets_v2_profile_id_check
          check (profile_id = 'profile:75ca7f418d66e6ab')
      );
      create table public.vocab_pronunciation_identities_v2 (
        identity_id text primary key,
        audio_provider text,
        pronunciation_variant_id text,
        official_audio_url text,
        sound_audio text,
        mw_notation text,
        storage_bucket text,
        storage_object_key text,
        audio_sha256 text,
        byte_count integer,
        profile_id text,
        request_sha256 text,
        model text,
        voice text,
        constraint vocab_pronunciation_identity_audio_v2 check (true)
      );

      create function private.import_vocab_synthetic_audio_package_v1(
        p_package jsonb
      ) returns jsonb language plpgsql as $$
      begin
        if jsonb_typeof(p_package) <> 'object'
          or p_package ->> 'profile_id' <> 'profile:5b6efb0ecc8f4702'
        then
          raise exception 'invalid_synthetic_audio_package';
        end if;
        return p_package;
      end;
      $$;
      create function private.import_vocab_synthetic_word_audio_package_v1(
        p_package jsonb
      ) returns jsonb language plpgsql as $$
      begin
        if jsonb_typeof(p_package) is distinct from 'object'
          or p_package ->> 'profile_id' is distinct from
            'profile:75ca7f418d66e6ab'
        then
          raise exception 'invalid_synthetic_word_audio_package';
        end if;
        return p_package;
      end;
      $$;
      create function public.import_vocab_synthetic_audio_package_v1(
        p_package jsonb
      ) returns jsonb language sql as $$
        select private.import_vocab_synthetic_audio_package_v1(p_package);
      $$;
      create function public.import_vocab_synthetic_word_audio_package_v1(
        p_package jsonb
      ) returns jsonb language sql as $$
        select private.import_vocab_synthetic_word_audio_package_v1(p_package);
      $$;
      create function private.import_rule_derived_korean_pronunciation_package_v2(
        p_package jsonb
      ) returns jsonb language plpgsql as $$
      begin
        perform 1
        from (values (1)) as occurrence(id)
        left join lateral (
          select
            'profile:286866721f7f4ee8' as expression_profile,
            'profile:1a77d56d47e26013' as word_profile
        ) as asset on true;
        return p_package;
      end;
      $$;
      create function public.import_rule_derived_korean_pronunciation_package_v2(
        p_package jsonb
      ) returns jsonb language sql as $$
        select private.import_rule_derived_korean_pronunciation_package_v2(
          p_package
        );
      $$;
      grant execute on function
        private.import_vocab_synthetic_audio_package_v1(jsonb) to service_role;
      grant execute on function
        private.import_vocab_synthetic_word_audio_package_v1(jsonb) to service_role;
    `);

    await database.exec(await readFile(migrationPath, "utf8"));
    await database.exec(await readFile(hardeningMigrationPath, "utf8"));

    await database.exec(`
      insert into public.vocab_synthetic_audio_assets values
        ('old-expression', 'expression:test', 'profile:5b6efb0ecc8f4702', 0.88),
        ('new-expression', 'expression:test', 'profile:286866721f7f4ee8', 1.0),
        ('old-word', 'word:test', 'profile:75ca7f418d66e6ab', 0.88),
        ('new-word', 'word:test', 'profile:1a77d56d47e26013', 1.0);
      insert into public.vocab_synthetic_audio_bindings (
        release_id, vocab_entry_id, profile_id
      ) values
        ('release:test', 1, 'profile:75ca7f418d66e6ab'),
        ('release:test', 1, 'profile:1a77d56d47e26013');
    `);

    await expect(
      database.exec(`
        insert into public.vocab_synthetic_audio_assets values (
          'crossed', 'word:test', 'profile:1a77d56d47e26013', 0.88
        )
      `),
    ).rejects.toThrow();
    await expect(
      database.query(`
        select private.import_vocab_synthetic_word_audio_package_v1(
          '{}'::jsonb
        )
      `),
    ).rejects.toThrow("invalid_synthetic_word_audio_package");
    await expect(
      database.exec(`
        insert into public.vocab_synthetic_audio_bindings (
          release_id, vocab_entry_id, profile_id
        ) values ('release:test', 1, 'profile:1a77d56d47e26013')
      `),
    ).rejects.toThrow();

    const requestHash = "a".repeat(64);
    await database.exec(`
      insert into public.vocab_pronunciation_tts_assets_v2 values (
        '${requestHash}',
        'pronunciation/google_cloud_text_to_speech/profile-1a77d56d47e26013/ability-voca-etymology-2025-v1/${requestHash}.mp3',
        'profile:1a77d56d47e26013'
      );
      insert into public.vocab_pronunciation_identities_v2 values (
        'normal-rate', 'google_cloud_text_to_speech',
        'synthetic:${requestHash}', null, null, null,
        'vocab-pronunciation-audio',
        'pronunciation/google_cloud_text_to_speech/profile-1a77d56d47e26013/ability-voca-etymology-2025-v1/${requestHash}.mp3',
        '${"b".repeat(64)}', 4096, 'profile:1a77d56d47e26013',
        '${requestHash}', 'chirp3-hd', 'en-US-Chirp3-HD-Despina'
      );
    `);
    await expect(
      database.exec(`
        insert into public.vocab_pronunciation_tts_assets_v2 values (
          '${"c".repeat(64)}',
          'pronunciation/google_cloud_text_to_speech/profile-75ca7f418d66e6ab/ability-voca-etymology-2025-v1/${"c".repeat(64)}.mp3',
          'profile:1a77d56d47e26013'
        )
      `),
    ).rejects.toThrow();

    const normalExpressionPackage = {
      profile_id: "profile:286866721f7f4ee8",
      profile: { speaking_rate: 1 },
      items: [
        { profile_id: "profile:286866721f7f4ee8", speaking_rate: 1 },
      ],
    };
    const imported = await database.query<{ profile_id: string }>(`
      select result ->> 'profile_id' as profile_id
      from public.import_vocab_synthetic_audio_package_v1(
        '${JSON.stringify(normalExpressionPackage)}'::jsonb
      ) as result
    `);
    expect(imported.rows).toEqual([
      { profile_id: "profile:286866721f7f4ee8" },
    ]);

    const privileges = await database.query<{
      private_allowed: boolean;
      public_allowed: boolean;
      public_anon_allowed: boolean;
      public_authenticated_allowed: boolean;
    }>(`
      select
        has_function_privilege(
          'service_role',
          'private.import_vocab_synthetic_audio_package_v1(jsonb)',
          'execute'
        ) as private_allowed,
        has_function_privilege(
          'service_role',
          'public.import_vocab_synthetic_audio_package_v1(jsonb)',
          'execute'
        ) as public_allowed,
        has_function_privilege(
          'anon',
          'public.import_vocab_synthetic_audio_package_v1(jsonb)',
          'execute'
        ) as public_anon_allowed,
        has_function_privilege(
          'authenticated',
          'public.import_vocab_synthetic_audio_package_v1(jsonb)',
          'execute'
        ) as public_authenticated_allowed
    `);
    expect(privileges.rows).toEqual([
      {
        private_allowed: false,
        public_allowed: true,
        public_anon_allowed: false,
        public_authenticated_allowed: false,
      },
    ]);
  });
});
