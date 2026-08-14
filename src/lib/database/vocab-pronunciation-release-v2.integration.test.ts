import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  "supabase/migrations/20260814110956_add_vocab_pronunciation_release_v2.sql",
);
const indexMigrationPath = path.resolve(
  "supabase/migrations/20260814214422_add_vocab_pronunciation_v2_fk_indexes.sql",
);
const datasetId = "11111111-1111-4111-8111-111111111111";
const packageVersion = "B".repeat(64);
const releaseId = `voca-release:${packageVersion.toLowerCase()}`;

function sqlJson(value: unknown) {
  return JSON.stringify(value).replaceAll("'", "''");
}

describe("VOCA pronunciation release v2 database", () => {
  it("rejects incomplete audio/stress and activates one exact 3,001-row release", async () => {
    const database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema private;
      create table public.vocab_datasets (
        id uuid primary key,
        dataset_key text not null unique,
        source_sha256 text not null,
        row_count integer not null,
        status text not null default 'ready',
        is_active boolean not null default true
      );
      create table public.vocab_entries (
        id bigint generated always as identity primary key,
        dataset_id uuid not null references public.vocab_datasets(id),
        source_row integer not null,
        row_sha256 text not null,
        headword text not null,
        headword_normalized text not null,
        unique (id, dataset_id),
        unique (dataset_id, source_row)
      );
      insert into public.vocab_datasets (
        id, dataset_key, source_sha256, row_count
      ) values (
        '${datasetId}',
        'ability-voca-etymology-2025',
        '${"9FB5B8307C5E695853E2E0E49DE07DD9CD20D29BC59C749DED4D2D07B4C92133"}',
        3001
      );
      insert into public.vocab_entries (
        dataset_id, source_row, row_sha256, headword, headword_normalized
      )
      select '${datasetId}', value, repeat('A', 64), 'test', 'test'
      from generate_series(1, 3001) as value;
    `);
    await database.exec(await readFile(migrationPath, "utf8"));
    await database.exec(await readFile(indexMigrationPath, "utf8"));

    const malformedSegments = await database.query<{ valid: boolean }>(`
      select private.valid_vocab_pronunciation_segments_v2(
        '테스트',
        '[{"text":"테","stress":"primary"},{"text":"스트"}]'::jsonb
      ) as valid
    `);
    expect(malformedSegments.rows).toEqual([{ valid: false }]);

    await expect(
      database.exec(`
        insert into public.vocab_pronunciation_identities_v2 (
          identity_id, headword, headword_normalized, lexical_pos,
          pronunciation_variant_id, audio_provider, official_audio_url,
          sound_audio, display_pronunciation_ko, segments, display_source,
          engine_version, stress_evidence, arpabet_phones, cmudict_sources,
          cmudict_stress_shape, playback_enabled, display_enabled,
          approval_evidence, identity_content_sha256
        ) values (
          'pron:v2:${"0".repeat(64)}', 'test', 'test', 'noun',
          'mw:${"0".repeat(20)}', 'merriam_webster', null, 'test0001',
          '테스트', '[{"text":"테스트","stress":"primary"}]'::jsonb,
          'deterministic_rule_v1', 'cmudict-arpabet-hangul-render-v1',
          'selected_webster_lexical_stress', '["T","EH1","S","T"]'::jsonb,
          '["cmudict:test"]'::jsonb,
          '{"syllable_count":1,"primary_index":0,"secondary_indexes":[]}'::jsonb,
          true, true, '{}'::jsonb, '${"0".repeat(64)}'
        )
      `),
    ).rejects.toThrow();

    const header = {
      schema_version: "vocab-pronunciation-release-v2",
      dataset_key: "ability-voca-etymology-2025",
      dataset_source_sha256:
        "9FB5B8307C5E695853E2E0E49DE07DD9CD20D29BC59C749DED4D2D07B4C92133",
      source_plan_version: "C".repeat(64),
      source_tts_manifest_sha256: "D".repeat(64),
      package_version: packageVersion,
      release_id: releaseId,
      engine_version: "cmudict-arpabet-hangul-render-v1",
      expected_entry_count: 3001,
      expected_identity_count: 1,
      expected_webster_binding_count: 3001,
      expected_tts_binding_count: 0,
      expected_tts_asset_count: 0,
    };
    await database.exec(`
      select public.stage_vocab_pronunciation_release_v2(
        '${sqlJson(header)}'::jsonb
      )
    `);
    await expect(
      database.exec(`
        select public.stage_vocab_pronunciation_release_v2(
          '${sqlJson({ ...header, expected_identity_count: 2 })}'::jsonb
        )
      `),
    ).rejects.toThrow("vocab_pronunciation_release_identity_conflict_v2");

    const identity = {
      identity_id: `pron:v2:${"1".repeat(64)}`,
      headword: "test",
      headword_normalized: "test",
      lexical_pos: "noun",
      pronunciation_variant_id: `mw:${"2".repeat(20)}`,
      audio_provider: "merriam_webster",
      official_audio_url:
        "https://media.merriam-webster.com/audio/prons/en/us/mp3/t/test0001.mp3",
      sound_audio: "test0001",
      mw_notation: "ˈtest",
      storage_bucket: null,
      storage_object_key: null,
      audio_sha256: null,
      byte_count: null,
      profile_id: null,
      request_sha256: null,
      model: null,
      voice: null,
      display_pronunciation_ko: "테스트",
      segments: [
        { text: "테", stress: "primary" },
        { text: "스트", stress: "none" },
      ],
      display_source: "deterministic_rule_v1",
      engine_version: "cmudict-arpabet-hangul-render-v1",
      stress_evidence: "selected_webster_lexical_stress",
      arpabet_phones: ["T", "EH1", "S", "T"],
      cmudict_sources: ["cmudict:test"],
      cmudict_stress_shape: {
        syllable_count: 1,
        primary_index: 0,
        secondary_indexes: [],
      },
      playback_enabled: true,
      display_enabled: true,
      approval_evidence: {},
      identity_content_sha256: "E".repeat(64),
    };
    await database.exec(`
      select public.import_vocab_pronunciation_identity_batch_v2(
        '${releaseId}', '${sqlJson([identity])}'::jsonb
      )
    `);

    for (let start = 1; start <= 3001; start += 400) {
      const end = Math.min(3001, start + 399);
      await database.exec(`
        select public.import_vocab_pronunciation_binding_batch_v2(
          '${releaseId}',
          (
            select jsonb_agg(jsonb_build_object(
              'source_row', value,
              'entry_row_sha256', repeat('A', 64),
              'headword', 'test',
              'headword_normalized', 'test',
              'identity_id', 'pron:v2:${"1".repeat(64)}',
              'lexical_pos', 'noun',
              'is_entry_default', true,
              'is_pos_default', true,
              'selection_rank', 1,
              'selection_basis', 'fixture',
              'selection_confidence', 'rule_selected',
              'binding_content_sha256', repeat('F', 64)
            ))
            from generate_series(${start}, ${end}) as value
          )
        )
      `);
    }

    const activated = await database.query<{
      status: string;
      binding_count: number;
      identity_count: number;
      unbound_entry_count: number;
    }>(`
      select
        result ->> 'status' as status,
        (result ->> 'binding_count')::integer as binding_count,
        (result ->> 'identity_count')::integer as identity_count,
        (result ->> 'unbound_entry_count')::integer as unbound_entry_count
      from (
        select public.activate_vocab_pronunciation_release_v2('${releaseId}') as result
      ) as activation
    `);
    expect(activated.rows).toEqual([
      {
        status: "active",
        binding_count: 3001,
        identity_count: 1,
        unbound_entry_count: 0,
      },
    ]);

    const privileges = await database.query<{
      can_insert: boolean;
      can_public_rpc: boolean;
      can_private_rpc: boolean;
    }>(`
      select
        has_table_privilege(
          'service_role', 'public.vocab_pronunciation_identities_v2', 'INSERT'
        ) as can_insert,
        has_function_privilege(
          'service_role',
          'public.activate_vocab_pronunciation_release_v2(text)',
          'EXECUTE'
        ) as can_public_rpc,
        has_function_privilege(
          'service_role',
          'private.activate_vocab_pronunciation_release_v2(text)',
          'EXECUTE'
        ) as can_private_rpc
    `);
    expect(privileges.rows).toEqual([
      {
        can_insert: false,
        can_public_rpc: true,
        can_private_rpc: false,
      },
    ]);
    await database.close();
  }, 30_000);
});
