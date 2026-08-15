import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  validateSyntheticAudioFiles,
  validateSyntheticAudioManifest,
} from "@/lib/vocab/synthetic-audio-import-contract";

function hash(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const audio = Buffer.concat([Buffer.from("ID3\x04"), Buffer.alloc(140, 7)]);
  const requestHash = "1".repeat(64);
  const item = {
    asset_id: `synthetic:${requestHash}`,
    dictionary_id: "expression:emerge-from-4925a141",
    headword: "emerge from",
    speech_text: "emerge from",
    occurrence_count: 1,
    occurrence_ids: ["occ:test"],
    source_queue_item_sha256: "2".repeat(64),
    source_package_sha256: "3".repeat(64),
    provider: "google_cloud_text_to_speech",
    model: "chirp3-hd",
    voice: "en-US-Chirp3-HD-Despina",
    language_code: "en-US",
    audio_encoding: "MP3",
    speaking_rate: 0.88,
    volume_gain_db: 4,
    profile_id: "profile:5b6efb0ecc8f4702",
    pronunciation_mode: "provider_default_expression",
    request_sha256: requestHash,
    object_file: `objects/${requestHash}.mp3`,
    storage_bucket: "vocab-pronunciation-audio",
    storage_object_key: `pronunciation/google_cloud_text_to_speech/profile-5b6efb0ecc8f4702/${requestHash}.mp3`,
    pronunciation_variant_id: null,
    pronunciation_identity_type: "dictionary_expression",
    canonical_ipa: null,
    google_tts_ipa: null,
    canonical_pronunciation_unchanged: true,
    audio_sha256: hash(audio),
    byte_count: audio.length,
    generated_at_utc: "2026-08-13T00:00:00Z",
    attempt_count: 1,
    generation_status: "generated",
    review_status: "profile_approved_generated",
  } as const;
  return {
    audio,
    manifest: {
      schema_version: "google-chirp-synthetic-audio-batch-v1",
      batch_id: "g12-long-reading-2025-expressions-v1",
      status: "complete",
      started_at_utc: "2026-08-13T00:00:00Z",
      completed_at_utc: "2026-08-13T00:01:00Z",
      endpoint: "https://texttospeech.googleapis.com/v1/text:synthesize",
      secret_recorded: false,
      canonical_pronunciation_modified: false,
      app_release_allowed: true,
      release_scope: "expression_synthetic_assistive_audio_only",
      canonical_pronunciation_approval_implied: false,
      release_gate: "local_generation_verified",
      source_queue_sha256: "4".repeat(64),
      source_profile_sha256: "5".repeat(64),
      source_exam_package_sha256: "3".repeat(64),
      source_exam_package_version: "6".repeat(64),
      dataset_key: "test-dataset",
      source_package_sha256: "3".repeat(64),
      profile_id: "profile:5b6efb0ecc8f4702",
      profile: {
        provider: "google_cloud_text_to_speech",
        model: "chirp3-hd",
        voice: "en-US-Chirp3-HD-Despina",
        language_code: "en-US",
        audio_encoding: "MP3",
        speaking_rate: 0.88,
        volume_gain_db: 4,
      },
      selection: { dictionary_id_prefix: "expression:" },
      expected_asset_count: 1,
      expected_occurrence_count: 1,
      generated_asset_count: 1,
      total_byte_count: audio.length,
      items: [item],
    },
  };
}

describe("synthetic audio import contract", () => {
  it("승인 프로필과 표현 결속값이 맞는 manifest를 허용한다", () => {
    const { manifest } = fixture();
    expect(validateSyntheticAudioManifest(manifest).summary).toMatchObject({
      assetCount: 1,
      occurrenceCount: 1,
      emergeFromIncluded: true,
    });
  });

  it("일반 속도 표현 프로필을 허용하고 프로필과 속도가 어긋나면 거부한다", () => {
    const { manifest } = fixture();
    const profileId = "profile:286866721f7f4ee8";
    const normalRate = {
      ...manifest,
      profile_id: profileId,
      profile: { ...manifest.profile, speaking_rate: 1 },
      items: manifest.items.map((item) => ({
        ...item,
        profile_id: profileId,
        speaking_rate: 1,
        storage_object_key:
          `pronunciation/google_cloud_text_to_speech/profile-286866721f7f4ee8/${item.request_sha256}.mp3`,
      })),
    };

    expect(validateSyntheticAudioManifest(normalRate).summary.profileId).toBe(
      profileId,
    );
    expect(() =>
      validateSyntheticAudioManifest({
        ...normalRate,
        profile: { ...normalRate.profile, speaking_rate: 0.88 },
      }),
    ).toThrow("profile과 재생 속도");
  });

  it("canonical 승인으로 위장하거나 object key가 다르면 거부한다", () => {
    const { manifest } = fixture();
    expect(() =>
      validateSyntheticAudioManifest({
        ...manifest,
        canonical_pronunciation_approval_implied: true,
      }),
    ).toThrow();
    expect(() =>
      validateSyntheticAudioManifest({
        ...manifest,
        items: [{ ...manifest.items[0], storage_object_key: "wrong.mp3" }],
      }),
    ).toThrow();
  });

  it("로컬 MP3 바이트와 해시를 확인한다", async () => {
    const { manifest, audio } = fixture();
    const directory = await mkdtemp(path.join(os.tmpdir(), "synthetic-audio-"));
    const manifestPath = path.join(directory, "manifest.json");
    const objectPath = path.join(
      directory,
      "objects",
      `${"1".repeat(64)}.mp3`,
    );
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(path.dirname(objectPath), { recursive: true }),
    );
    await writeFile(objectPath, audio);
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(validateSyntheticAudioFiles(manifestPath, manifest)).resolves.toMatchObject({
      summary: { assetCount: 1 },
    });
    await writeFile(objectPath, Buffer.concat([audio, Buffer.from("bad")]));
    await expect(validateSyntheticAudioFiles(manifestPath, manifest)).rejects.toThrow(
      "파일 검증",
    );
  });
});
