import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const HEX64 = /^[0-9a-f]{64}$/;
const WORD_ID = /^word:[a-z0-9][a-z0-9._'’-]*$/;
const OCCURRENCE_ID = /^occ:[a-z0-9][a-z0-9._-]*$/;
const VARIANT_ID = /^tts(?:word|occ):[a-z0-9][a-z0-9:._-]*$/;
export const WORD_SYNTHETIC_PROFILE_ID = "profile:75ca7f418d66e6ab";
const VOICE = "en-US-Chirp3-HD-Despina";
const BUCKET = "vocab-pronunciation-audio";

const itemSchema = z
  .object({
    asset_id: z.string().regex(/^synthetic:[0-9a-f]{64}$/),
    dictionary_id: z.string().regex(WORD_ID),
    headword: z.string().trim().min(1).max(160),
    speech_text: z.string().trim().min(1).max(160),
    occurrence_count: z.int().positive(),
    occurrence_ids: z.array(z.string().regex(OCCURRENCE_ID)).min(1),
    source_queue_item_sha256: z.string().regex(HEX64),
    source_package_sha256: z.string().regex(HEX64),
    provider: z.literal("google_cloud_text_to_speech"),
    model: z.literal("chirp3-hd"),
    voice: z.literal(VOICE),
    language_code: z.literal("en-US"),
    audio_encoding: z.literal("MP3"),
    speaking_rate: z.literal(0.88),
    volume_gain_db: z.literal(4),
    profile_id: z.literal(WORD_SYNTHETIC_PROFILE_ID),
    pronunciation_mode: z.enum([
      "provider_default_word_surface",
      "custom_ipa_word_surface",
    ]),
    request_sha256: z.string().regex(HEX64),
    object_file: z.string().regex(/^objects\/[0-9a-f]{64}[.]mp3$/),
    storage_bucket: z.literal(BUCKET),
    storage_object_key: z
      .string()
      .regex(
        /^pronunciation\/google_cloud_text_to_speech\/profile-[0-9a-f]{16}\/[0-9a-f]{64}[.]mp3$/,
      ),
    pronunciation_variant_id: z.string().regex(VARIANT_ID),
    pronunciation_identity_type: z.enum([
      "dictionary_word_surface",
      "occurrence_word_phrase",
    ]),
    canonical_ipa: z.string().trim().min(1).max(300).nullable(),
    google_tts_ipa: z.string().trim().min(1).max(300).nullable(),
    canonical_pronunciation_unchanged: z.literal(true),
    audio_sha256: z.string().regex(HEX64),
    byte_count: z.int().min(128).max(1_048_576),
    generated_at_utc: z.iso.datetime(),
    attempt_count: z.int().min(1).max(8),
    generation_status: z.enum(["generated", "reused_verified"]),
    review_status: z.literal("profile_approved_generated"),
  })
  .strict();

const manifestSchema = z
  .object({
    schema_version: z.literal(
      "google-chirp-synthetic-word-audio-batch-v1",
    ),
    batch_id: z.literal("g12-long-reading-2025-word-surfaces-v1"),
    status: z.literal("complete"),
    started_at_utc: z.iso.datetime(),
    completed_at_utc: z.iso.datetime(),
    endpoint: z.literal("https://texttospeech.googleapis.com/v1/text:synthesize"),
    secret_recorded: z.literal(false),
    canonical_pronunciation_modified: z.literal(false),
    app_release_allowed: z.literal(true),
    release_scope: z.literal("word_surface_synthetic_assistive_audio_only"),
    canonical_pronunciation_approval_implied: z.literal(false),
    release_gate: z.literal("local_generation_verified"),
    source_queue_sha256: z.string().regex(HEX64),
    source_decisions_sha256: z.string().regex(HEX64),
    source_profile_sha256: z.string().regex(HEX64),
    source_exam_package_sha256: z.string().regex(HEX64),
    source_exam_package_version: z.string().regex(HEX64),
    dataset_key: z.literal("g12-long-reading-2025-exam-scope-v1"),
    source_package_sha256: z.string().regex(HEX64),
    profile_id: z.literal(WORD_SYNTHETIC_PROFILE_ID),
    profile: z
      .object({
        provider: z.literal("google_cloud_text_to_speech"),
        model: z.literal("chirp3-hd"),
        voice: z.literal(VOICE),
        language_code: z.literal("en-US"),
        audio_encoding: z.literal("MP3"),
        speaking_rate: z.literal(0.88),
        volume_gain_db: z.literal(4),
      })
      .strict(),
    selection: z
      .object({
        dictionary_id_prefix: z.literal("word:"),
        decision_route: z.literal("google_chirp"),
      })
      .strict(),
    expected_asset_count: z.literal(28),
    expected_occurrence_count: z.literal(29),
    generated_asset_count: z.literal(28),
    total_byte_count: z.int().positive(),
    items: z.array(itemSchema).length(28),
  })
  .strict();

export type SyntheticWordAudioManifest = z.infer<typeof manifestSchema>;
export type SyntheticWordAudioManifestItem = z.infer<typeof itemSchema>;

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function isMp3(value: Buffer) {
  return (
    value.length >= 128 &&
    (value.subarray(0, 3).toString("ascii") === "ID3" || value[0] === 0xff)
  );
}

export function validateSyntheticWordAudioManifest(input: unknown) {
  const manifest = manifestSchema.parse(input);
  const surfaceIdentities = new Set<string>();
  const requestHashes = new Set<string>();
  const occurrenceIds = new Set<string>();
  const customIpaSurfaces = new Set<string>();
  const occurrencePhraseSurfaces = new Set<string>();
  let byteCount = 0;

  for (const item of manifest.items) {
    const surfaceIdentity =
      `${item.dictionary_id}\u0000${item.speech_text}` +
      `\u0000${item.pronunciation_variant_id}`;
    const ipaPairPresent = item.canonical_ipa !== null && item.google_tts_ipa !== null;
    if (
      item.asset_id !== `synthetic:${item.request_sha256}` ||
      item.object_file !== `objects/${item.request_sha256}.mp3` ||
      item.storage_object_key !==
        `pronunciation/google_cloud_text_to_speech/${item.profile_id.replace(":", "-")}/${item.request_sha256}.mp3` ||
      item.occurrence_ids.length !== item.occurrence_count ||
      new Set(item.occurrence_ids).size !== item.occurrence_count ||
      (item.pronunciation_mode === "custom_ipa_word_surface") !== ipaPairPresent ||
      (item.canonical_ipa === null) !== (item.google_tts_ipa === null) ||
      (item.pronunciation_identity_type === "occurrence_word_phrase" &&
        (item.occurrence_count !== 1 ||
          item.pronunciation_mode !== "provider_default_word_surface"))
    ) {
      throw new Error(`단어 합성 음원 결속값이 올바르지 않습니다: ${item.dictionary_id}`);
    }
    if (surfaceIdentities.has(surfaceIdentity) || requestHashes.has(item.request_sha256)) {
      throw new Error("단어 합성 음원 manifest에 중복 자산이 있습니다.");
    }
    surfaceIdentities.add(surfaceIdentity);
    requestHashes.add(item.request_sha256);
    for (const occurrenceId of item.occurrence_ids) {
      if (occurrenceIds.has(occurrenceId)) {
        throw new Error("단어 합성 음원 manifest에 중복 출현 ID가 있습니다.");
      }
      occurrenceIds.add(occurrenceId);
    }
    if (ipaPairPresent) customIpaSurfaces.add(item.speech_text);
    if (item.pronunciation_identity_type === "occurrence_word_phrase") {
      occurrencePhraseSurfaces.add(item.speech_text);
    }
    byteCount += item.byte_count;
  }

  if (
    occurrenceIds.size !== 29 ||
    byteCount !== manifest.total_byte_count ||
    JSON.stringify([...customIpaSurfaces].sort()) !==
      JSON.stringify(["artefact", "re-rendering"]) ||
    JSON.stringify([...occurrencePhraseSurfaces].sort()) !==
      JSON.stringify(["disaster struck", "tend to", "voice trembling"]) ||
    !manifest.items.some(
      (item) => item.dictionary_id === "word:sparkle" && item.occurrence_count === 2,
    )
  ) {
    throw new Error("단어 합성 음원 manifest 집계가 승인 범위와 다릅니다.");
  }

  return {
    manifest,
    summary: {
      assetCount: manifest.items.length,
      occurrenceCount: occurrenceIds.size,
      totalByteCount: byteCount,
      customIpaAssetCount: customIpaSurfaces.size,
      occurrencePhraseAssetCount: occurrencePhraseSurfaces.size,
      profileId: manifest.profile_id,
      datasetKey: manifest.dataset_key,
    },
  };
}

export async function validateSyntheticWordAudioFiles(
  manifestPath: string,
  input: unknown,
) {
  const validated = validateSyntheticWordAudioManifest(input);
  const baseDirectory = path.dirname(path.resolve(manifestPath));
  const files = await Promise.all(
    validated.manifest.items.map(async (item) => {
      const absolutePath = path.resolve(baseDirectory, item.object_file);
      const relative = path.relative(baseDirectory, absolutePath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("단어 합성 음원 파일 경로가 manifest 폴더를 벗어납니다.");
      }
      const value = await readFile(absolutePath);
      if (
        !isMp3(value) ||
        value.length !== item.byte_count ||
        sha256(value) !== item.audio_sha256
      ) {
        throw new Error(`단어 합성 음원 파일 검증에 실패했습니다: ${item.dictionary_id}`);
      }
      return { item, absolutePath, value };
    }),
  );
  return { ...validated, files };
}
