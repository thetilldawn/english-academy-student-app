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

function nucleusFixture() {
  const release = fixture();
  const identity = release.identities[0];
  identity.identity_id = `pron:v3:${"5".repeat(64)}`;
  identity.engine_version = "cmudict-arpabet-hangul-nucleus-render-v2";
  identity.display_source = "deterministic_nucleus_rule_v2";
  identity.identity_content_sha256 = computeVocabPronunciationIdentityHash(
    identity as unknown as Record<string, unknown>,
  );
  for (const binding of release.bindings) {
    binding.identity_id = identity.identity_id;
    binding.binding_content_sha256 = computeVocabPronunciationBindingHash(
      binding as unknown as Record<string, unknown>,
    );
  }
  release.engine_version = "cmudict-arpabet-hangul-nucleus-render-v2";
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

  it("accepts the separate v3 nucleus generation and rejects mixed generation IDs", () => {
    expect(validateVocabPronunciationReleaseV2(nucleusFixture()).summary).toMatchObject({
      binding_count: 3001,
      identity_count: 1,
    });
    const mixed = nucleusFixture();
    mixed.identities[0].identity_id = `pron:v2:${"5".repeat(64)}`;
    mixed.identities[0].identity_content_sha256 =
      computeVocabPronunciationIdentityHash(
        mixed.identities[0] as unknown as Record<string, unknown>,
      );
    expect(() => validateVocabPronunciationReleaseV2(mixed)).toThrow(
      "발음 엔진과 표시 출처",
    );
  });

  it("accepts the normal-rate VOCA TTS profile and rejects a crossed profile path", () => {
    const release = fixture();
    const requestHash = "6".repeat(64);
    const identity = release.identities[0];
    Object.assign(identity as unknown as Record<string, unknown>, {
      identity_id: `pron:v2:${"7".repeat(64)}`,
      pronunciation_variant_id: `synthetic:${requestHash}`,
      audio_provider: "google_cloud_text_to_speech",
      official_audio_url: null,
      sound_audio: null,
      mw_notation: null,
      storage_bucket: "vocab-pronunciation-audio",
      storage_object_key:
        `pronunciation/google_cloud_text_to_speech/profile-1a77d56d47e26013/ability-voca-etymology-2025-v1/${requestHash}.mp3`,
      audio_sha256: "8".repeat(64),
      byte_count: 4096,
      profile_id: "profile:1a77d56d47e26013",
      request_sha256: requestHash,
      model: "chirp3-hd",
      voice: "en-US-Chirp3-HD-Despina",
    });
    identity.identity_content_sha256 = computeVocabPronunciationIdentityHash(
      identity as unknown as Record<string, unknown>,
    );
    for (const binding of release.bindings) {
      binding.identity_id = identity.identity_id;
      binding.binding_content_sha256 = computeVocabPronunciationBindingHash(
        binding as unknown as Record<string, unknown>,
      );
    }
    release.summary.webster_binding_count = 0;
    release.summary.tts_binding_count = 3001;
    release.summary.tts_asset_count = 1;
    release.package_version = computeVocabPronunciationPackageVersion(
      release as unknown as Record<string, unknown>,
    );
    release.release_id =
      `voca-release:${release.package_version.toLowerCase()}`;

    expect(validateVocabPronunciationReleaseV2(release).summary).toMatchObject({
      tts_binding_count: 3001,
      tts_asset_count: 1,
    });

    Object.assign(identity as unknown as Record<string, unknown>, {
      storage_object_key:
        `pronunciation/google_cloud_text_to_speech/profile-75ca7f418d66e6ab/ability-voca-etymology-2025-v1/${requestHash}.mp3`,
    });
    identity.identity_content_sha256 = computeVocabPronunciationIdentityHash(
      identity as unknown as Record<string, unknown>,
    );
    release.package_version = computeVocabPronunciationPackageVersion(
      release as unknown as Record<string, unknown>,
    );
    release.release_id =
      `voca-release:${release.package_version.toLowerCase()}`;
    expect(() => validateVocabPronunciationReleaseV2(release)).toThrow(
      "Google TTS",
    );
  });
});
