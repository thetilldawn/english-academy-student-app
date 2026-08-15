import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { validateSyntheticWordAudioManifest } from "@/lib/vocab/synthetic-word-audio-import-contract";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const surfaces = [
    "aesthetics",
    "art-independent",
    "artefact",
    "basics",
    "billion-dollar",
    "cheering",
    "closely",
    "crushed",
    "disheartening",
    "eagerly",
    "father-to-be",
    "filmed",
    "hand-made",
    "healthier",
    "in-person",
    "photographed",
    "prize-winning",
    "quietly",
    "re-rendering",
    "rewriting",
    "selflessness",
    "show-winning",
    "sparkling",
    "stands",
    "disaster struck",
    "tend to",
    "voice trembling",
    "wiser",
  ];
  const phraseSurfaces = new Set(["disaster struck", "tend to", "voice trembling"]);
  const ipaSurfaces = new Set(["artefact", "re-rendering"]);
  const items = surfaces.map((surface, index) => {
    const requestHash = hash(`request-${index}`);
    const occurrenceIds =
      surface === "sparkling"
        ? ["occ:sparkling-one", "occ:sparkling-two"]
        : [`occ:item-${index}`];
    return {
      asset_id: `synthetic:${requestHash}`,
      dictionary_id:
        surface === "sparkling" ? "word:sparkle" : `word:item-${index}`,
      headword: surface,
      speech_text: surface,
      occurrence_count: occurrenceIds.length,
      occurrence_ids: occurrenceIds,
      source_queue_item_sha256: hash(`queue-${index}`),
      source_package_sha256: "1".repeat(64),
      provider: "google_cloud_text_to_speech",
      model: "chirp3-hd",
      voice: "en-US-Chirp3-HD-Despina",
      language_code: "en-US",
      audio_encoding: "MP3",
      speaking_rate: 0.88,
      volume_gain_db: 4,
      profile_id: "profile:75ca7f418d66e6ab",
      pronunciation_mode: ipaSurfaces.has(surface)
        ? "custom_ipa_word_surface"
        : "provider_default_word_surface",
      request_sha256: requestHash,
      object_file: `objects/${requestHash}.mp3`,
      storage_bucket: "vocab-pronunciation-audio",
      storage_object_key: `pronunciation/google_cloud_text_to_speech/profile-75ca7f418d66e6ab/${requestHash}.mp3`,
      pronunciation_variant_id: phraseSurfaces.has(surface)
        ? `ttsocc:item-${index}:${surface.replaceAll(" ", "-")}`
        : `ttsword:item-${index}:${surface.replaceAll(" ", "-")}`,
      pronunciation_identity_type: phraseSurfaces.has(surface)
        ? "occurrence_word_phrase"
        : "dictionary_word_surface",
      canonical_ipa: ipaSurfaces.has(surface) ? `canonical-${index}` : null,
      google_tts_ipa: ipaSurfaces.has(surface) ? `google-${index}` : null,
      canonical_pronunciation_unchanged: true,
      audio_sha256: hash(`audio-${index}`),
      byte_count: 200 + index,
      generated_at_utc: "2026-08-14T00:00:00Z",
      attempt_count: 1,
      generation_status: "generated",
      review_status: "profile_approved_generated",
    };
  });
  return {
    schema_version: "google-chirp-synthetic-word-audio-batch-v1",
    batch_id: "g12-long-reading-2025-word-surfaces-v1",
    status: "complete",
    started_at_utc: "2026-08-14T00:00:00Z",
    completed_at_utc: "2026-08-14T00:01:00Z",
    endpoint: "https://texttospeech.googleapis.com/v1/text:synthesize",
    secret_recorded: false,
    canonical_pronunciation_modified: false,
    app_release_allowed: true,
    release_scope: "word_surface_synthetic_assistive_audio_only",
    canonical_pronunciation_approval_implied: false,
    release_gate: "local_generation_verified",
    source_queue_sha256: "2".repeat(64),
    source_decisions_sha256: "3".repeat(64),
    source_profile_sha256: "4".repeat(64),
    source_exam_package_sha256: "1".repeat(64),
    source_exam_package_version: "5".repeat(64),
    dataset_key: "g12-long-reading-2025-exam-scope-v1",
    source_package_sha256: "1".repeat(64),
    profile_id: "profile:75ca7f418d66e6ab",
    profile: {
      provider: "google_cloud_text_to_speech",
      model: "chirp3-hd",
      voice: "en-US-Chirp3-HD-Despina",
      language_code: "en-US",
      audio_encoding: "MP3",
      speaking_rate: 0.88,
      volume_gain_db: 4,
    },
    selection: { dictionary_id_prefix: "word:", decision_route: "google_chirp" },
    expected_asset_count: 28,
    expected_occurrence_count: 29,
    generated_asset_count: 28,
    total_byte_count: items.reduce((total, item) => total + item.byte_count, 0),
    items,
  };
}

describe("synthetic word audio import contract", () => {
  it("28개 자산·29회 출현과 IPA/구절 범위를 허용한다", () => {
    expect(validateSyntheticWordAudioManifest(fixture()).summary).toMatchObject({
      assetCount: 28,
      occurrenceCount: 29,
      customIpaAssetCount: 2,
      occurrencePhraseAssetCount: 3,
    });
  });

  it("일반 속도 단어 프로필을 허용하고 항목 속도 혼합을 거부한다", () => {
    const manifest = fixture();
    const profileId = "profile:1a77d56d47e26013";
    const normalRate = {
      ...manifest,
      profile_id: profileId,
      profile: { ...manifest.profile, speaking_rate: 1 },
      items: manifest.items.map((item) => ({
        ...item,
        profile_id: profileId,
        speaking_rate: 1,
        storage_object_key:
          `pronunciation/google_cloud_text_to_speech/profile-1a77d56d47e26013/${item.request_sha256}.mp3`,
      })),
    };

    expect(
      validateSyntheticWordAudioManifest(normalRate).summary.profileId,
    ).toBe(profileId);
    expect(() =>
      validateSyntheticWordAudioManifest({
        ...normalRate,
        items: normalRate.items.map((item, index) =>
          index === 0 ? { ...item, speaking_rate: 0.88 } : item,
        ),
      }),
    ).toThrow("결속값");
  });

  it("IPA 한쪽만 있거나 sparkling 결속이 빠지면 거부한다", () => {
    const oneSided = fixture();
    oneSided.items[2].google_tts_ipa = null;
    expect(() => validateSyntheticWordAudioManifest(oneSided)).toThrow();

    const wrongSparkling = fixture();
    wrongSparkling.items[22].occurrence_ids = ["occ:sparkling-one"];
    wrongSparkling.items[22].occurrence_count = 1;
    expect(() => validateSyntheticWordAudioManifest(wrongSparkling)).toThrow();

    const phraseWithCustomIpa = fixture();
    phraseWithCustomIpa.items[24].pronunciation_mode =
      "custom_ipa_word_surface";
    phraseWithCustomIpa.items[24].canonical_ipa = "canonical";
    phraseWithCustomIpa.items[24].google_tts_ipa = "google";
    expect(() =>
      validateSyntheticWordAudioManifest(phraseWithCustomIpa),
    ).toThrow();
  });

  it("같은 철자라도 품사별 논리 발음 ID가 다르면 별도 자산을 허용한다", () => {
    const heteronyms = fixture();
    heteronyms.items[1].dictionary_id = heteronyms.items[0].dictionary_id;
    heteronyms.items[1].headword = heteronyms.items[0].headword;
    heteronyms.items[1].speech_text = heteronyms.items[0].speech_text;
    heteronyms.items[1].pronunciation_variant_id =
      "ttsword:aesthetics:aesthetics:verb";
    expect(() => validateSyntheticWordAudioManifest(heteronyms)).not.toThrow();

    heteronyms.items[1].pronunciation_variant_id =
      heteronyms.items[0].pronunciation_variant_id;
    expect(() => validateSyntheticWordAudioManifest(heteronyms)).toThrow();
  });
});
