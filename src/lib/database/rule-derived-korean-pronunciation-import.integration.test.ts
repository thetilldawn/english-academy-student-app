import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  "supabase/migrations/20260814094039_add_rule_derived_korean_pronunciations.sql",
);
const repairIdentityMigrationPath = path.resolve(
  "supabase/migrations/20260814094628_fix_rule_derived_webster_repair_identity.sql",
);

function fixture() {
  return {
    schema_version: "rule-derived-korean-pronunciation-batch-v1",
    package_id: "rule-derived-test-v2",
    dataset_key: "g12-long-reading-2025-exam-scope-v1",
    source_exam_package_version: "2".repeat(64),
    status: "complete",
    derivation_method: "cmudict_arpabet_to_hangul_dynamic_alignment",
    engine_version: "cmudict-hangul-align-v2",
    confidence_scope: "hangul_alignment_only",
    display_semantics: "lexical_stress_not_tts_acoustic_prosody",
    target_environment: "staging",
    generated_at_utc: "2026-08-14T00:00:00Z",
    source_exam_package_sha256: "3".repeat(64),
    source_cmudict_sha256: "4".repeat(64),
    source_cmudict_commit: "5".repeat(40),
    source_corrections_sha256: "6".repeat(64),
    source_expression_manifest_sha256: "7".repeat(64),
    source_word_manifest_sha256: "8".repeat(64),
    source_webster_repair_sha256: "9".repeat(64),
    expected_occurrence_count: 1,
    covered_occurrence_count: 1,
    held_occurrence_count: 0,
    identity_count: 1,
    confidence_occurrence_counts: { high: 1, medium: 0, low: 0 },
    stress_evidence_occurrence_counts: {
      selected_webster_lexical_stress: 1,
      cmudict_lexical_stress_phrase_rule: 0,
      cmudict_lexical_stress: 0,
    },
    items: [
      {
        dictionary_id: "word:meanwhile",
        headword: "meanwhile",
        pronunciation_identity_type: "webster_selected",
        pronunciation_variant_id: "mw:288fb5a854433c5f7580",
        display_pronunciation_ko: "민와일",
        segments: [
          { text: "민", stress: "primary" },
          { text: "와일", stress: "secondary" },
        ],
        derivation_status: "rule_derived",
        engine_version: "cmudict-hangul-align-v2",
        confidence: "high",
        confidence_scope: "hangul_alignment_only",
        stress_evidence: "selected_webster_lexical_stress",
        alignment_cost: 0.1,
        alignment_margin: 0.2,
        webster_mw_notation: "ˈmēn-ˌ(h)wī(-ə)l",
        webster_cmu_primary_match: true,
        selected_webster_stress_applied: true,
        cmudict_sources: ["cmudict:meanwhile"],
        cmudict_stress_shape: {
          syllable_count: 2,
          primary_index: 0,
          secondary_indexes: [1],
        },
        raw_cmudict_stress_shape: {
          syllable_count: 2,
          primary_index: 0,
          secondary_indexes: [1],
        },
        source_audio_sha256: "1".repeat(64),
        occurrence_ids: ["occ:meanwhile-test"],
        content_sha256: "a".repeat(64),
      },
    ],
    package_version: "b".repeat(64),
  };
}

async function setupDatabase() {
  const database = new PGlite();
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema private;
    create schema word_index;
    create function private.valid_korean_pronunciation_segments_v1(
      p_display text,
      p_segments jsonb
    ) returns boolean language sql immutable strict set search_path = '' as $$
      select
        jsonb_typeof(p_segments) = 'array'
        and jsonb_array_length(p_segments) > 0
        and not exists (
          select 1 from jsonb_array_elements(p_segments) as segment(value)
          where coalesce(segment.value ->> 'text', '') = ''
             or coalesce(segment.value ->> 'stress', '') not in
               ('none', 'secondary', 'primary')
        )
        and (
          select string_agg(segment.value ->> 'text', '' order by segment.ordinality)
          from jsonb_array_elements(p_segments) with ordinality
            as segment(value, ordinality)
        ) = p_display;
    $$;
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
  `);
  await database.exec(await readFile(migrationPath, "utf8"));
  await database.exec(await readFile(repairIdentityMigrationPath, "utf8"));
  const pronunciationPackage = fixture();
  await database.query(
    `insert into word_index.app_exam_use_release (
      release_id, dataset_key, package_version, status
    ) values ('release-test', $1, $2, 'active')`,
    [
      pronunciationPackage.dataset_key,
      pronunciationPackage.source_exam_package_version,
    ],
  );
  await database.query(
    `insert into word_index.app_exam_use_occurrence (
      release_id,
      occurrence_id,
      dictionary_id,
      display_headword,
      include_in_exam,
      listening_enabled,
      pronunciation_variant_id,
      raw_response_sha256,
      vocab_entry_id
    ) values ('release-test', $1, $2, $3, true, true, $4, $5, 101)`,
    [
      pronunciationPackage.items[0].occurrence_ids[0],
      pronunciationPackage.items[0].dictionary_id,
      pronunciationPackage.items[0].headword,
      pronunciationPackage.items[0].pronunciation_variant_id,
      pronunciationPackage.items[0].source_audio_sha256,
    ],
  );
  return database;
}

async function seedSyntheticFallback(database: PGlite) {
  await database.exec(`
    insert into public.vocab_synthetic_audio_assets (
      asset_id,
      dictionary_id,
      storage_verified,
      playback_enabled,
      audio_sha256
    ) values (
      'synthetic:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'word:meanwhile',
      true,
      true,
      '${"c".repeat(64)}'
    );
    insert into public.vocab_synthetic_audio_bindings (
      release_id,
      vocab_entry_id,
      dictionary_id,
      asset_id
    ) values (
      'release-test',
      101,
      'word:meanwhile',
      'synthetic:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    );
  `);
}

async function seedWebsterRepair(database: PGlite) {
  await database.exec(`
    insert into public.vocab_entry_pronunciations (
      vocab_entry_id,
      provider,
      status,
      review_status,
      listening_enabled,
      selected_variant_id,
      selected_audio_url,
      variants,
      raw_provenance
    ) values (
      101,
      'merriam_webster',
      'raw_first_variant_unreviewed',
      'raw_unreviewed',
      true,
      'mw:288fb5a854433c5f7580',
      'https://media.merriam-webster.com/audio/prons/en/us/mp3/m/meanwh01.mp3',
      '[{"variant_id":"mw:288fb5a854433c5f7580","audio_url":"https://media.merriam-webster.com/audio/prons/en/us/mp3/m/meanwh01.mp3"}]'::jsonb,
      '[{"raw_response_sha256":"${"1".repeat(64)}"}]'::jsonb
    );
  `);
}

describe("rule-derived Korean pronunciation atomic import", () => {
  it("최종 음원과 정확히 맞는 규칙 강세만 등록하고 재실행은 그대로 둔다", async () => {
    const database = await setupDatabase();
    const pronunciationPackage = fixture();
    const first = await database.query<{ result: Record<string, unknown> }>(
      "select public.import_rule_derived_korean_pronunciation_package_v1($1::jsonb) as result",
      [JSON.stringify(pronunciationPackage)],
    );
    expect(first.rows[0].result).toMatchObject({
      status: "ok",
      identityCount: 1,
      occurrenceCount: 1,
      insertedCount: 1,
      verifiedCount: 1,
    });
    const second = await database.query<{ result: Record<string, unknown> }>(
      "select public.import_rule_derived_korean_pronunciation_package_v1($1::jsonb) as result",
      [JSON.stringify(pronunciationPackage)],
    );
    expect(second.rows[0].result).toMatchObject({
      insertedCount: 0,
      verifiedCount: 1,
    });
    await database.close();
  });

  it("다른 음원 ID와 같은 음원의 다른 강세는 기존 행을 보존하고 거부한다", async () => {
    const database = await setupDatabase();
    const pronunciationPackage = fixture();
    await database.query(
      "select public.import_rule_derived_korean_pronunciation_package_v1($1::jsonb)",
      [JSON.stringify(pronunciationPackage)],
    );

    const wrongAudio = structuredClone(pronunciationPackage);
    wrongAudio.items[0].pronunciation_variant_id = `mw:${"c".repeat(20)}`;
    await expect(
      database.query(
        "select public.import_rule_derived_korean_pronunciation_package_v1($1::jsonb)",
        [JSON.stringify(wrongAudio)],
      ),
    ).rejects.toThrow("rule_derived_korean_pronunciation_audio_identity_mismatch");

    const changed = structuredClone(pronunciationPackage);
    changed.items[0].segments = [
      { text: "민", stress: "none" },
      { text: "와일", stress: "primary" },
    ];
    changed.items[0].content_sha256 = "d".repeat(64);
    await expect(
      database.query(
        "select public.import_rule_derived_korean_pronunciation_package_v1($1::jsonb)",
        [JSON.stringify(changed)],
      ),
    ).rejects.toThrow("rule_derived_korean_pronunciation_identity_conflict");

    const count = await database.query<{ count: number }>(
      "select count(*)::integer as count from public.vocab_rule_derived_korean_pronunciations",
    );
    expect(count.rows).toEqual([{ count: 1 }]);
    await database.close();
  });

  it("시험 원본에 음원이 없으면 Webster 보완을 합성 음원보다 먼저 선택한다", async () => {
    const database = await setupDatabase();
    const pronunciationPackage = fixture();
    pronunciationPackage.items[0].pronunciation_identity_type =
      "webster_repair";

    await database.exec(`
      update word_index.app_exam_use_occurrence
      set listening_enabled = false,
          pronunciation_variant_id = null
      where occurrence_id = 'occ:meanwhile-test';
    `);
    await seedWebsterRepair(database);
    await seedSyntheticFallback(database);

    const result = await database.query<{ result: Record<string, unknown> }>(
      "select public.import_rule_derived_korean_pronunciation_package_v1($1::jsonb) as result",
      [JSON.stringify(pronunciationPackage)],
    );
    expect(result.rows[0].result).toMatchObject({
      status: "ok",
      insertedCount: 1,
      verifiedCount: 1,
    });

    const wrongRepairHash = structuredClone(pronunciationPackage);
    wrongRepairHash.items[0].source_audio_sha256 = "d".repeat(64);
    await expect(
      database.query(
        "select public.import_rule_derived_korean_pronunciation_package_v1($1::jsonb)",
        [JSON.stringify(wrongRepairHash)],
      ),
    ).rejects.toThrow("rule_derived_korean_pronunciation_audio_identity_mismatch");
    await database.close();
  });

  it("시험 원본 음원은 Webster 보완과 합성 음원보다 우선한다", async () => {
    const database = await setupDatabase();
    await seedWebsterRepair(database);
    await seedSyntheticFallback(database);

    const result = await database.query<{ result: Record<string, unknown> }>(
      "select public.import_rule_derived_korean_pronunciation_package_v1($1::jsonb) as result",
      [JSON.stringify(fixture())],
    );
    expect(result.rows[0].result).toMatchObject({
      status: "ok",
      insertedCount: 1,
      verifiedCount: 1,
    });
    await database.close();
  });

  it("시험 원본과 Webster 보완이 없으면 검증된 합성 음원을 선택한다", async () => {
    const database = await setupDatabase();
    await database.exec(`
      update word_index.app_exam_use_occurrence
      set listening_enabled = false,
          pronunciation_variant_id = null
      where occurrence_id = 'occ:meanwhile-test';
    `);
    await seedSyntheticFallback(database);
    const pronunciationPackage = fixture();
    pronunciationPackage.items[0].pronunciation_identity_type =
      "synthetic_word_surface";
    pronunciationPackage.items[0].pronunciation_variant_id =
      `synthetic:${"c".repeat(64)}`;
    pronunciationPackage.items[0].source_audio_sha256 = "c".repeat(64);

    const result = await database.query<{ result: Record<string, unknown> }>(
      "select public.import_rule_derived_korean_pronunciation_package_v1($1::jsonb) as result",
      [JSON.stringify(pronunciationPackage)],
    );
    expect(result.rows[0].result).toMatchObject({
      status: "ok",
      insertedCount: 1,
      verifiedCount: 1,
    });
    await database.close();
  });
});
