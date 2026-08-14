import { describe, expect, it } from "vitest";

import {
  computeVocabPronunciationBindingHash,
  computeVocabPronunciationIdentityHash,
  computeVocabPronunciationPackageVersion,
  validateVocabPronunciationReleaseV2,
} from "./vocab-pronunciation-release-v2-contract";

function fixture() {
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
    identity_content_sha256: "",
  };
  identity.identity_content_sha256 = computeVocabPronunciationIdentityHash(
    identity as unknown as Record<string, unknown>,
  );
  const bindings = Array.from({ length: 3001 }, (_, index) => {
    const binding = {
      source_row: index + 1,
      entry_row_sha256: (index + 1)
        .toString(16)
        .toUpperCase()
        .padStart(64, "A")
        .slice(-64),
      headword: "test",
      headword_normalized: "test",
      identity_id: identity.identity_id,
      lexical_pos: "noun",
      is_entry_default: true,
      is_pos_default: true,
      selection_rank: 1,
      selection_basis: "fixture",
      selection_confidence: "rule_selected",
      binding_content_sha256: "",
    };
    binding.binding_content_sha256 = computeVocabPronunciationBindingHash(
      binding as unknown as Record<string, unknown>,
    );
    return binding;
  });
  const release = {
    schema_version: "vocab-pronunciation-release-v2",
    dataset_key: "ability-voca-etymology-2025",
    dataset_source_sha256:
      "9FB5B8307C5E695853E2E0E49DE07DD9CD20D29BC59C749DED4D2D07B4C92133",
    source_plan_version: "3".repeat(64),
    source_tts_manifest_sha256: "4".repeat(64),
    engine_version: "cmudict-arpabet-hangul-render-v1",
    identities: [identity],
    bindings,
    summary: {
      expected_entry_count: 3001,
      binding_count: 3001,
      identity_count: 1,
      webster_binding_count: 3001,
      tts_binding_count: 0,
      tts_asset_count: 0,
      playback_missing_count: 0,
      display_missing_count: 0,
    },
    package_version: "",
    release_id: "",
  };
  release.package_version = computeVocabPronunciationPackageVersion(
    release as unknown as Record<string, unknown>,
  );
  release.release_id = `voca-release:${release.package_version.toLowerCase()}`;
  return release;
}

describe("VOCA pronunciation release v2 contract", () => {
  it("accepts an exact 3,001-row immutable release", () => {
    const result = validateVocabPronunciationReleaseV2(fixture());
    expect(result.summary).toMatchObject({
      binding_count: 3001,
      identity_count: 1,
      webster_binding_count: 3001,
    });
  });

  it("rejects stress text that no longer matches the selected audio identity", () => {
    const release = fixture();
    release.identities[0].segments[0].stress = "none";
    expect(() => validateVocabPronunciationReleaseV2(release)).toThrow(
      "한글 발음 강세 구간",
    );
  });
});
