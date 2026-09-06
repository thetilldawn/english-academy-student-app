import { describe, expect, it } from "vitest";

import {
  computeVocabPronunciationBindingHash,
  computeVocabPronunciationIdentityHash,
  computeVocabPronunciationPackageVersion,
  validateVocabPronunciationReleaseV2,
} from "./vocab-pronunciation-release-v2-contract";

import { fixture, nucleusFixture } from "@/test-support/pronunciation-fixtures";

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
