import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = (name: string) =>
  readFile(path.resolve("supabase/migrations", name), "utf8");

async function setupDatabase(applyNucleusMigration = true) {
  const database = new PGlite();
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema private;
    create schema word_index;
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
    create table word_index.app_exam_use_release (
      release_id text primary key,
      dataset_key text not null,
      package_version text not null,
      status text not null
    );
    create table word_index.app_exam_use_occurrence (
      release_id text not null,
      occurrence_id text not null,
      dictionary_id text not null,
      display_headword text not null,
      include_in_exam boolean not null,
      listening_enabled boolean not null,
      pronunciation_variant_id text,
      raw_response_sha256 text,
      vocab_entry_id bigint
    );
    create table public.vocab_synthetic_audio_bindings (
      release_id text not null,
      vocab_entry_id bigint not null,
      dictionary_id text not null,
      asset_id text not null
    );
    create table public.vocab_synthetic_audio_assets (
      asset_id text primary key,
      dictionary_id text not null,
      storage_verified boolean not null,
      playback_enabled boolean not null,
      audio_sha256 text not null
    );
    create table public.vocab_entry_pronunciations (
      vocab_entry_id bigint primary key,
      provider text not null,
      status text not null,
      review_status text not null,
      listening_enabled boolean not null,
      selected_variant_id text,
      selected_audio_url text,
      variants jsonb not null,
      raw_provenance jsonb not null
    );
    insert into public.vocab_datasets (
      id, dataset_key, source_sha256, row_count
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'ability-voca-etymology-2025',
      '9FB5B8307C5E695853E2E0E49DE07DD9CD20D29BC59C749DED4D2D07B4C92133',
      3001
    );
    insert into public.vocab_entries (
      dataset_id, source_row, row_sha256, headword, headword_normalized
    )
    select
      '11111111-1111-4111-8111-111111111111',
      value,
      repeat('A', 64),
      'test',
      'test'
    from generate_series(1, 3001) as value;
  `);
  for (const name of [
    "20260813203000_add_approved_korean_pronunciation_segments.sql",
    "20260814094039_add_rule_derived_korean_pronunciations.sql",
    "20260814094628_fix_rule_derived_webster_repair_identity.sql",
    "20260814110956_add_vocab_pronunciation_release_v2.sql",
    "20260814214422_add_vocab_pronunciation_v2_fk_indexes.sql",
  ]) {
    await database.exec(await migration(name));
  }
  if (applyNucleusMigration) {
    await database.exec(
      await migration("20260814164215_add_pronunciation_nucleus_stress_v3.sql"),
    );
    await database.exec(
      await migration(
        "20260814170654_harden_legacy_pronunciation_release_generation.sql",
      ),
    );
  }
  return database;
}

function websterIdentity(generation: 2 | 3) {
  const nucleus = generation === 3;
  return {
    identity_id: `pron:v${generation}:${String(generation).repeat(64)}`,
    headword: "test",
    headword_normalized: "test",
    lexical_pos: "noun",
    pronunciation_variant_id: `mw:${"4".repeat(20)}`,
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
    display_source: nucleus
      ? "deterministic_nucleus_rule_v2"
      : "deterministic_rule_v1",
    engine_version: nucleus
      ? "cmudict-arpabet-hangul-nucleus-render-v2"
      : "cmudict-arpabet-hangul-render-v1",
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
    identity_content_sha256: String(generation).repeat(64),
  };
}

function ruleRevisionFixtures() {
  const sourcePackageVersion = "2".repeat(64);
  const items = Array.from({ length: 582 }, (_, index) => {
    const occurrenceIds = [`occ:nucleus-${index}`];
    if (index < 19) occurrenceIds.push(`occ:nucleus-${index}-second`);
    return {
      dictionary_id: `word:nucleus${index}`,
      headword: `nucleus${index}`,
      pronunciation_identity_type: "webster_selected",
      pronunciation_variant_id: `mw:${index.toString(16).padStart(20, "0")}`,
      display_pronunciation_ko: "테스트",
      segments: [
        { text: "테", stress: "primary" },
        { text: "스트", stress: "none" },
      ],
      derivation_status: "rule_derived",
      engine_version: "cmudict-hangul-nucleus-align-v3",
      confidence: "high",
      confidence_scope: "hangul_alignment_only",
      stress_evidence: "selected_webster_lexical_stress",
      alignment_cost: 0.1,
      alignment_margin: 0.2,
      webster_mw_notation: "ˈtest",
      webster_cmu_primary_match: true,
      selected_webster_stress_applied: true,
      cmudict_sources: [`cmudict:nucleus${index}`],
      cmudict_stress_shape: {
        syllable_count: 1,
        primary_index: 0,
        secondary_indexes: [],
      },
      raw_cmudict_stress_shape: {
        syllable_count: 1,
        primary_index: 0,
        secondary_indexes: [],
      },
      source_audio_sha256: index.toString(16).padStart(64, "a").slice(-64),
      occurrence_ids: occurrenceIds,
      content_sha256: index.toString(16).padStart(64, "b").slice(-64),
    };
  });
  const pronunciationPackage = {
    schema_version: "rule-derived-korean-pronunciation-batch-v1",
    package_id: "g12-long-reading-2025-rule-derived-stress-v3",
    dataset_key: "g12-long-reading-2025-exam-scope-v1",
    source_exam_package_version: sourcePackageVersion,
    status: "complete",
    derivation_method: "cmudict_arpabet_to_hangul_nucleus_alignment",
    engine_version: "cmudict-hangul-nucleus-align-v3",
    confidence_scope: "hangul_alignment_only",
    display_semantics: "lexical_stress_not_tts_acoustic_prosody",
    target_environment: "staging",
    generated_at_utc: "2026-08-15T00:00:00Z",
    source_exam_package_sha256: "3".repeat(64),
    source_cmudict_sha256: "4".repeat(64),
    source_cmudict_commit: "5".repeat(40),
    source_corrections_sha256: "6".repeat(64),
    source_expression_manifest_sha256: "7".repeat(64),
    source_word_manifest_sha256: "8".repeat(64),
    source_webster_repair_sha256: "9".repeat(64),
    expected_occurrence_count: 601,
    covered_occurrence_count: 601,
    held_occurrence_count: 0,
    identity_count: 582,
    confidence_occurrence_counts: { high: 601, medium: 0, low: 0 },
    stress_evidence_occurrence_counts: {
      selected_webster_lexical_stress: 601,
      cmudict_lexical_stress_phrase_rule: 0,
      cmudict_lexical_stress: 0,
    },
    items,
    package_version: "f".repeat(64),
  };
  return { items, pronunciationPackage, sourcePackageVersion };
}

describe("pronunciation vowel-nucleus v3 migration", () => {
  it("keeps v2 readable, admits a separate v3 identity, and revises exact approved spans", async () => {
    const database = await setupDatabase();
    const approved = await database.query<{
      dictionary_id: string;
      segments: unknown;
    }>(`
      select dictionary_id, segments
      from public.vocab_approved_korean_pronunciations
      where dictionary_id in ('word:loss', 'word:inspire')
      order by dictionary_id
    `);
    expect(approved.rows).toEqual([
      {
        dictionary_id: "word:inspire",
        segments: [
          { text: "인스", stress: "none" },
          { text: "파이", stress: "primary" },
          { text: "어", stress: "none" },
        ],
      },
      {
        dictionary_id: "word:loss",
        segments: [
          { text: "로", stress: "primary" },
          { text: "스", stress: "none" },
        ],
      },
    ]);

    const legacy = websterIdentity(2);
    await database.query(
      `insert into public.vocab_pronunciation_identities_v2 (
        identity_id, headword, headword_normalized, lexical_pos,
        pronunciation_variant_id, audio_provider, official_audio_url,
        sound_audio, mw_notation, storage_bucket, storage_object_key,
        audio_sha256, byte_count, profile_id, request_sha256, model, voice,
        display_pronunciation_ko, segments, display_source, engine_version,
        stress_evidence, arpabet_phones, cmudict_sources,
        cmudict_stress_shape, playback_enabled, display_enabled,
        approval_evidence, identity_content_sha256
      ) select * from jsonb_to_record($1::jsonb) as item(
        identity_id text, headword text, headword_normalized text,
        lexical_pos text, pronunciation_variant_id text, audio_provider text,
        official_audio_url text, sound_audio text, mw_notation text,
        storage_bucket text, storage_object_key text, audio_sha256 text,
        byte_count integer, profile_id text, request_sha256 text, model text,
        voice text, display_pronunciation_ko text, segments jsonb,
        display_source text, engine_version text, stress_evidence text,
        arpabet_phones jsonb, cmudict_sources jsonb,
        cmudict_stress_shape jsonb, playback_enabled boolean,
        display_enabled boolean, approval_evidence jsonb,
        identity_content_sha256 text
      )`,
      [JSON.stringify(legacy)],
    );

    const legacyPackageVersion = "E".repeat(64);
    const legacyReleaseId =
      `voca-release:${legacyPackageVersion.toLowerCase()}`;
    await database.query(
      `insert into public.vocab_pronunciation_releases_v2 (
        release_id, dataset_id, dataset_key, dataset_source_sha256,
        source_plan_version, source_tts_manifest_sha256, package_version,
        engine_version, status, expected_entry_count,
        expected_identity_count, expected_webster_binding_count,
        expected_tts_binding_count, expected_tts_asset_count, activated_at
      ) values (
        $1, '11111111-1111-4111-8111-111111111111',
        'ability-voca-etymology-2025',
        '9FB5B8307C5E695853E2E0E49DE07DD9CD20D29BC59C749DED4D2D07B4C92133',
        $2, $3, $4, 'cmudict-arpabet-hangul-render-v1', 'active',
        3001, 1, 3001, 0, 0, now()
      )`,
      [legacyReleaseId, "F".repeat(64), "A".repeat(64), legacyPackageVersion],
    );
    await database.query(
      `insert into public.vocab_entry_pronunciation_bindings_v2 (
        release_id, vocab_entry_id, dataset_id, source_row,
        entry_row_sha256, headword, headword_normalized, identity_id,
        lexical_pos, is_entry_default, is_pos_default, selection_rank,
        selection_basis, selection_confidence, binding_content_sha256
      ) select
        $1, id, dataset_id, source_row, upper(row_sha256), headword,
        headword_normalized, $2, 'noun', true, true, 1, 'legacy fixture',
        'rule_selected', $3
      from public.vocab_entries where source_row = 1`,
      [legacyReleaseId, legacy.identity_id, "9".repeat(64)],
    );
    const legacyHeader = {
      schema_version: "vocab-pronunciation-release-v2",
      dataset_key: "ability-voca-etymology-2025",
      dataset_source_sha256:
        "9FB5B8307C5E695853E2E0E49DE07DD9CD20D29BC59C749DED4D2D07B4C92133",
      source_plan_version: "F".repeat(64),
      source_tts_manifest_sha256: "A".repeat(64),
      package_version: legacyPackageVersion,
      release_id: legacyReleaseId,
      engine_version: "cmudict-arpabet-hangul-render-v1",
      expected_entry_count: 3001,
      expected_identity_count: 1,
      expected_webster_binding_count: 3001,
      expected_tts_binding_count: 0,
      expected_tts_asset_count: 0,
    };
    const legacyStage = await database.query<{
      result: Record<string, unknown>;
    }>("select public.stage_vocab_pronunciation_release_v2($1::jsonb) as result", [
      JSON.stringify(legacyHeader),
    ]);
    expect(legacyStage.rows[0].result).toMatchObject({
      release_id: legacyReleaseId,
      status: "active",
    });

    const packageVersion = "B".repeat(64);
    const releaseId = `voca-release:${packageVersion.toLowerCase()}`;
    const header = {
      schema_version: "vocab-pronunciation-release-v2",
      dataset_key: "ability-voca-etymology-2025",
      dataset_source_sha256:
        "9FB5B8307C5E695853E2E0E49DE07DD9CD20D29BC59C749DED4D2D07B4C92133",
      source_plan_version: "C".repeat(64),
      source_tts_manifest_sha256: "D".repeat(64),
      package_version: packageVersion,
      release_id: releaseId,
      engine_version: "cmudict-arpabet-hangul-nucleus-render-v2",
      expected_entry_count: 3001,
      expected_identity_count: 1,
      expected_webster_binding_count: 3001,
      expected_tts_binding_count: 0,
      expected_tts_asset_count: 0,
    };
    await database.query(
      "select public.stage_vocab_pronunciation_release_v3($1::jsonb)",
      [JSON.stringify(header)],
    );
    const nucleus = websterIdentity(3);
    await expect(
      database.query(
        "select public.stage_vocab_pronunciation_release_v2($1::jsonb)",
        [JSON.stringify(header)],
      ),
    ).rejects.toThrow("vocab_pronunciation_release_generation_mismatch_v2");
    await expect(
      database.query(
        "select public.import_vocab_pronunciation_identity_batch_v2($1, $2::jsonb)",
        [releaseId, JSON.stringify([nucleus])],
      ),
    ).rejects.toThrow("vocab_pronunciation_release_generation_mismatch_v2");
    await expect(
      database.query(
        "select public.import_vocab_pronunciation_binding_batch_v2($1, $2::jsonb)",
        [releaseId, JSON.stringify([])],
      ),
    ).rejects.toThrow("vocab_pronunciation_release_generation_mismatch_v2");
    await expect(
      database.query(
        "select public.verify_vocab_pronunciation_release_v2($1)",
        [releaseId],
      ),
    ).rejects.toThrow("vocab_pronunciation_release_generation_mismatch_v2");
    await expect(
      database.query(
        "select public.activate_vocab_pronunciation_release_v2($1)",
        [releaseId],
      ),
    ).rejects.toThrow("vocab_pronunciation_release_generation_mismatch_v2");
    await database.query(
      "select public.import_vocab_pronunciation_identity_batch_v3($1, $2::jsonb)",
      [releaseId, JSON.stringify([nucleus])],
    );
    await expect(
      database.query(
        "select public.import_vocab_pronunciation_identity_batch_v3($1, $2::jsonb)",
        [releaseId, JSON.stringify([legacy])],
      ),
    ).rejects.toThrow("vocab_pronunciation_identity_generation_mismatch_v3");

    const bindings = Array.from({ length: 3001 }, (_, index) => ({
      source_row: index + 1,
      entry_row_sha256: "A".repeat(64),
      headword: "test",
      headword_normalized: "test",
      identity_id: nucleus.identity_id,
      lexical_pos: "noun",
      is_entry_default: true,
      is_pos_default: true,
      selection_rank: 1,
      selection_basis: "nucleus fixture",
      selection_confidence: "rule_selected",
      binding_content_sha256: (index + 1)
        .toString(16)
        .toUpperCase()
        .padStart(64, "A")
        .slice(-64),
    }));
    await expect(
      database.query(
        "select public.import_vocab_pronunciation_binding_batch_v3($1, $2::jsonb)",
        [
          releaseId,
          JSON.stringify([{ ...bindings[0], identity_id: legacy.identity_id }]),
        ],
      ),
    ).rejects.toThrow("vocab_pronunciation_binding_scope_mismatch_v3");
    for (let offset = 0; offset < bindings.length; offset += 300) {
      await database.query(
        "select public.import_vocab_pronunciation_binding_batch_v3($1, $2::jsonb)",
        [releaseId, JSON.stringify(bindings.slice(offset, offset + 300))],
      );
    }
    const verification = await database.query<{
      result: Record<string, unknown>;
    }>("select public.verify_vocab_pronunciation_release_v3($1) as result", [
      releaseId,
    ]);
    expect(verification.rows[0].result).toMatchObject({
      binding_count: 3001,
      identity_count: 1,
      engine_version: "cmudict-arpabet-hangul-nucleus-render-v2",
    });
    await database.query(
      "select public.activate_vocab_pronunciation_release_v3($1)",
      [releaseId],
    );
    const identities = await database.query<{ engine_version: string }>(`
      select engine_version
      from public.vocab_pronunciation_identities_v2
      where headword_normalized = 'test'
      order by engine_version
    `);
    expect(identities.rows.map(({ engine_version }) => engine_version)).toEqual([
      "cmudict-arpabet-hangul-nucleus-render-v2",
      "cmudict-arpabet-hangul-render-v1",
    ]);

    const releases = await database.query<{
      release_id: string;
      status: string;
    }>(`
      select release_id, status
      from public.vocab_pronunciation_releases_v2
      order by release_id
    `);
    expect(releases.rows).toEqual([
      { release_id: releaseId, status: "active" },
      { release_id: legacyReleaseId, status: "retired" },
    ]);
    const legacyBindingCount = await database.query<{ count: number }>(
      `select count(*)::integer as count
       from public.vocab_entry_pronunciation_bindings_v2
       where release_id = $1`,
      [legacyReleaseId],
    );
    expect(legacyBindingCount.rows).toEqual([{ count: 1 }]);

    await expect(
      database.exec(`
        insert into public.vocab_approved_korean_pronunciations (
          dictionary_id, pronunciation_variant_id, display_pronunciation_ko,
          segments, review_status, source_content_sha256,
          source_review_run_id
        ) values (
          'expression:emerge-from-4925a141',
          'synthetic:210af750c6450691a7973aab3fa0139ec4675051d32937ab6ac8b92e14118123',
          '이머지 프럼',
          '[{"text":"이","stress":"none"},{"text":"머지","stress":"primary"},{"text":" 프럼","stress":"none"}]'::jsonb,
          'approved', '${"7".repeat(64)}', 'old-canary'
        )
      `),
    ).rejects.toThrow();

    const privileges = await database.query<{
      private_binding: boolean;
      public_binding: boolean;
    }>(`
      select
        has_function_privilege(
          'service_role',
          'private.import_vocab_pronunciation_binding_batch_v3(text,jsonb)',
          'EXECUTE'
        ) as private_binding,
        has_function_privilege(
          'service_role',
          'public.import_vocab_pronunciation_binding_batch_v3(text,jsonb)',
          'EXECUTE'
        ) as public_binding
    `);
    expect(privileges.rows).toEqual([
      { private_binding: false, public_binding: true },
    ]);
    await database.close();
  }, 20_000);

  it("atomically revises all 582 rule rows and is idempotent", async () => {
    const database = await setupDatabase(false);
    const { items, pronunciationPackage, sourcePackageVersion } =
      ruleRevisionFixtures();
    await database.query(
      `insert into word_index.app_exam_use_release (
        release_id, dataset_key, package_version, status
      ) values ('rule-release', $1, $2, 'active')`,
      [pronunciationPackage.dataset_key, sourcePackageVersion],
    );
    const occurrences = items.flatMap((item) =>
      item.occurrence_ids.map((occurrence_id) => ({
        occurrence_id,
        dictionary_id: item.dictionary_id,
        display_headword: item.headword,
        pronunciation_variant_id: item.pronunciation_variant_id,
        raw_response_sha256: item.source_audio_sha256,
      })),
    );
    await database.query(
      `insert into word_index.app_exam_use_occurrence (
        release_id, occurrence_id, dictionary_id, display_headword,
        include_in_exam, listening_enabled, pronunciation_variant_id,
        raw_response_sha256, vocab_entry_id
      )
      select 'rule-release', item.occurrence_id, item.dictionary_id,
        item.display_headword, true, true, item.pronunciation_variant_id,
        item.raw_response_sha256, null
      from jsonb_to_recordset($1::jsonb) as item(
        occurrence_id text, dictionary_id text, display_headword text,
        pronunciation_variant_id text, raw_response_sha256 text
      )`,
      [JSON.stringify(occurrences)],
    );
    await database.query(
      `insert into public.vocab_rule_derived_korean_pronunciations (
        dictionary_id, pronunciation_variant_id, headword,
        pronunciation_identity_type, display_pronunciation_ko, segments,
        derivation_status, engine_version, confidence, confidence_scope,
        stress_evidence, alignment_cost, alignment_margin,
        source_audio_sha256, content_sha256, occurrence_ids, correction_id,
        derivation_metadata, dataset_key, source_exam_package_version,
        source_exam_package_sha256, source_cmudict_sha256,
        source_cmudict_commit, source_corrections_sha256,
        source_expression_manifest_sha256, source_word_manifest_sha256,
        source_webster_repair_sha256, package_version
      )
      select item.dictionary_id, item.pronunciation_variant_id, item.headword,
        item.pronunciation_identity_type, item.display_pronunciation_ko,
        '[{"text":"테스트","stress":"primary"}]'::jsonb,
        item.derivation_status, 'cmudict-hangul-align-v2', item.confidence,
        item.confidence_scope, item.stress_evidence, 0.2, 0.3,
        item.source_audio_sha256, repeat('c', 64), item.occurrence_ids, null,
        jsonb_build_object(
          'cmudictSources', item.cmudict_sources,
          'cmudictStressShape', item.cmudict_stress_shape,
          'rawCmudictStressShape', item.raw_cmudict_stress_shape,
          'websterMwNotation', item.webster_mw_notation,
          'websterCmuPrimaryMatch', item.webster_cmu_primary_match,
          'selectedWebsterStressApplied', item.selected_webster_stress_applied
        ),
        $2, $3, $4, $5, $6, $7, $8, $9, $10,
        'de916a6cc7979c8e455efbfd63874c74ab8e55015b5b75ad9ebb6986916dcd25'
      from jsonb_to_recordset($1::jsonb) as item(
        dictionary_id text, pronunciation_variant_id text, headword text,
        pronunciation_identity_type text, display_pronunciation_ko text,
        derivation_status text, confidence text, confidence_scope text,
        stress_evidence text, source_audio_sha256 text, occurrence_ids jsonb,
        cmudict_sources jsonb, cmudict_stress_shape jsonb,
        raw_cmudict_stress_shape jsonb, webster_mw_notation text,
        webster_cmu_primary_match boolean,
        selected_webster_stress_applied boolean
      )`,
      [
        JSON.stringify(items),
        pronunciationPackage.dataset_key,
        sourcePackageVersion,
        pronunciationPackage.source_exam_package_sha256,
        pronunciationPackage.source_cmudict_sha256,
        pronunciationPackage.source_cmudict_commit,
        pronunciationPackage.source_corrections_sha256,
        pronunciationPackage.source_expression_manifest_sha256,
        pronunciationPackage.source_word_manifest_sha256,
        pronunciationPackage.source_webster_repair_sha256,
      ],
    );
    await database.exec(
      await migration("20260814164215_add_pronunciation_nucleus_stress_v3.sql"),
    );
    await database.exec(
      await migration(
        "20260815103000_add_production_rule_derived_pronunciation_import.sql",
      ),
    );
    const productionPackage = {
      ...pronunciationPackage,
      package_id:
        "g12-long-reading-2025-rule-derived-stress-production-v3",
      target_environment: "production",
    };
    const first = await database.query<{ result: Record<string, unknown> }>(
      "select public.import_rule_derived_korean_pronunciation_package_production_v3($1::jsonb) as result",
      [JSON.stringify(productionPackage)],
    );
    expect(first.rows[0].result).toMatchObject({
      packageId:
        "g12-long-reading-2025-rule-derived-stress-production-v3",
      targetEnvironment: "production",
      insertedCount: 0,
      updatedCount: 582,
      verifiedCount: 582,
      occurrenceCount: 601,
    });
    const second = await database.query<{ result: Record<string, unknown> }>(
      "select public.import_rule_derived_korean_pronunciation_package_production_v3($1::jsonb) as result",
      [JSON.stringify(productionPackage)],
    );
    expect(second.rows[0].result).toMatchObject({
      insertedCount: 0,
      updatedCount: 0,
      verifiedCount: 582,
    });
    const engines = await database.query<{ count: number }>(`
      select count(*)::integer as count
      from public.vocab_rule_derived_korean_pronunciations
      where engine_version = 'cmudict-hangul-nucleus-align-v3'
        and segments =
          '[{"text":"테","stress":"primary"},{"text":"스트","stress":"none"}]'::jsonb
    `);
    expect(engines.rows).toEqual([{ count: 582 }]);
    const privileges = await database.query<{
      private_import: boolean;
      public_import: boolean;
    }>(`
      select
        has_function_privilege(
          'service_role',
          'private.import_rule_derived_korean_pronunciation_package_production_v3(jsonb)',
          'EXECUTE'
        ) as private_import,
        has_function_privilege(
          'service_role',
          'public.import_rule_derived_korean_pronunciation_package_production_v3(jsonb)',
          'EXECUTE'
        ) as public_import
    `);
    expect(privileges.rows).toEqual([
      { private_import: false, public_import: true },
    ]);
    await database.close();
  }, 20_000);
});
