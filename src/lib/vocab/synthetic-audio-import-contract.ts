import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const HEX64 = /^[0-9a-f]{64}$/;
const EXPRESSION_ID = /^expression:[a-z0-9][a-z0-9._'’-]*$/;
const OCCURRENCE_ID = /^occ:[a-z0-9][a-z0-9._-]*$/;
const EXPRESSION_PROFILE_RATES = {
  "profile:5b6efb0ecc8f4702": 0.88,
  "profile:286866721f7f4ee8": 1,
} as const;
const EXPRESSION_PROFILE_IDS = Object.keys(EXPRESSION_PROFILE_RATES) as [
  keyof typeof EXPRESSION_PROFILE_RATES,
  ...(keyof typeof EXPRESSION_PROFILE_RATES)[],
];
const BATCH_VOICE = "en-US-Chirp3-HD-Despina";
const STORAGE_BUCKET = "vocab-pronunciation-audio";

const itemSchema = z
  .object({
    asset_id: z.string().regex(/^synthetic:[0-9a-f]{64}$/),
    dictionary_id: z.string().regex(EXPRESSION_ID),
    headword: z.string().trim().min(1).max(160),
    speech_text: z.string().trim().min(1).max(160),
    occurrence_count: z.int().positive(),
    occurrence_ids: z.array(z.string().regex(OCCURRENCE_ID)).min(1),
    source_queue_item_sha256: z.string().regex(HEX64),
    source_package_sha256: z.string().regex(HEX64),
    provider: z.literal("google_cloud_text_to_speech"),
    model: z.literal("chirp3-hd"),
    voice: z.literal(BATCH_VOICE),
    language_code: z.literal("en-US"),
    audio_encoding: z.literal("MP3"),
    speaking_rate: z.union([z.literal(0.88), z.literal(1)]),
    volume_gain_db: z.literal(4),
    profile_id: z.enum(EXPRESSION_PROFILE_IDS),
    pronunciation_mode: z.literal("provider_default_expression"),
    request_sha256: z.string().regex(HEX64),
    object_file: z.string().regex(/^objects\/[0-9a-f]{64}[.]mp3$/),
    storage_bucket: z.literal(STORAGE_BUCKET),
    storage_object_key: z
      .string()
      .regex(
        /^pronunciation\/google_cloud_text_to_speech\/profile-[0-9a-f]{16}\/[0-9a-f]{64}[.]mp3$/,
      ),
    pronunciation_variant_id: z.null(),
    pronunciation_identity_type: z.literal("dictionary_expression"),
    canonical_ipa: z.null(),
    google_tts_ipa: z.null(),
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
    schema_version: z.literal("google-chirp-synthetic-audio-batch-v1"),
    batch_id: z.literal("g12-long-reading-2025-expressions-v1"),
    status: z.literal("complete"),
    started_at_utc: z.iso.datetime(),
    completed_at_utc: z.iso.datetime(),
    endpoint: z.literal("https://texttospeech.googleapis.com/v1/text:synthesize"),
    secret_recorded: z.literal(false),
    canonical_pronunciation_modified: z.literal(false),
    app_release_allowed: z.literal(true),
    release_scope: z.literal("expression_synthetic_assistive_audio_only"),
    canonical_pronunciation_approval_implied: z.literal(false),
    release_gate: z.literal("local_generation_verified"),
    source_queue_sha256: z.string().regex(HEX64),
    source_profile_sha256: z.string().regex(HEX64),
    source_exam_package_sha256: z.string().regex(HEX64),
    source_exam_package_version: z.string().regex(HEX64),
    dataset_key: z.string().trim().min(3).max(200),
    source_package_sha256: z.string().regex(HEX64),
    profile_id: z.enum(EXPRESSION_PROFILE_IDS),
    profile: z
      .object({
        provider: z.literal("google_cloud_text_to_speech"),
        model: z.literal("chirp3-hd"),
        voice: z.literal(BATCH_VOICE),
        language_code: z.literal("en-US"),
        audio_encoding: z.literal("MP3"),
        speaking_rate: z.union([z.literal(0.88), z.literal(1)]),
        volume_gain_db: z.literal(4),
      })
      .strict(),
    selection: z
      .object({ dictionary_id_prefix: z.literal("expression:") })
      .strict(),
    expected_asset_count: z.int().positive(),
    expected_occurrence_count: z.int().positive(),
    generated_asset_count: z.int().positive(),
    total_byte_count: z.int().positive(),
    items: z.array(itemSchema).min(1),
  })
  .strict();

export type SyntheticAudioManifest = z.infer<typeof manifestSchema>;
export type SyntheticAudioManifestItem = z.infer<typeof itemSchema>;

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function isMp3(value: Buffer) {
  return (
    value.length >= 128 &&
    (value.subarray(0, 3).toString("ascii") === "ID3" || value[0] === 0xff)
  );
}

export function validateSyntheticAudioManifest(input: unknown) {
  const manifest = manifestSchema.parse(input);
  const dictionaryIds = new Set<string>();
  const requestHashes = new Set<string>();
  const occurrenceIds = new Set<string>();
  let occurrenceCount = 0;
  let byteCount = 0;
  const expectedRate = EXPRESSION_PROFILE_RATES[manifest.profile_id];

  if (manifest.profile.speaking_rate !== expectedRate) {
    throw new Error("합성 음원 profile과 재생 속도가 다릅니다.");
  }

  for (const item of manifest.items) {
    if (
      item.asset_id !== `synthetic:${item.request_sha256}` ||
      item.object_file !== `objects/${item.request_sha256}.mp3` ||
      item.storage_object_key !==
        `pronunciation/google_cloud_text_to_speech/${item.profile_id.replace(":", "-")}/${item.request_sha256}.mp3` ||
      item.occurrence_ids.length !== item.occurrence_count ||
      new Set(item.occurrence_ids).size !== item.occurrence_count ||
      item.profile_id !== manifest.profile_id ||
      item.speaking_rate !== expectedRate
    ) {
      throw new Error(`합성 음원 결속값이 올바르지 않습니다: ${item.dictionary_id}`);
    }
    if (dictionaryIds.has(item.dictionary_id) || requestHashes.has(item.request_sha256)) {
      throw new Error("합성 음원 manifest에 중복 자산이 있습니다.");
    }
    dictionaryIds.add(item.dictionary_id);
    requestHashes.add(item.request_sha256);
    for (const occurrenceId of item.occurrence_ids) {
      if (occurrenceIds.has(occurrenceId)) {
        throw new Error("합성 음원 manifest에 중복 출현 ID가 있습니다.");
      }
      occurrenceIds.add(occurrenceId);
    }
    occurrenceCount += item.occurrence_count;
    byteCount += item.byte_count;
  }

  if (
    manifest.items.length !== manifest.expected_asset_count ||
    manifest.generated_asset_count !== manifest.expected_asset_count ||
    occurrenceCount !== manifest.expected_occurrence_count ||
    byteCount !== manifest.total_byte_count ||
    !manifest.items.some(
      (item) =>
        item.dictionary_id === "expression:emerge-from-4925a141" &&
        item.speech_text === "emerge from",
    )
  ) {
    throw new Error("합성 음원 manifest 집계가 고정 범위와 다릅니다.");
  }

  return {
    manifest,
    summary: {
      assetCount: manifest.items.length,
      occurrenceCount,
      totalByteCount: byteCount,
      profileId: manifest.profile_id,
      datasetKey: manifest.dataset_key,
      emergeFromIncluded: true,
    },
  };
}

export async function validateSyntheticAudioFiles(
  manifestPath: string,
  input: unknown,
) {
  const validated = validateSyntheticAudioManifest(input);
  const baseDirectory = path.dirname(path.resolve(manifestPath));
  const files = await Promise.all(
    validated.manifest.items.map(async (item) => {
      const absolutePath = path.resolve(baseDirectory, item.object_file);
      const relative = path.relative(baseDirectory, absolutePath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("합성 음원 파일 경로가 manifest 폴더를 벗어납니다.");
      }
      const value = await readFile(absolutePath);
      if (
        !isMp3(value) ||
        value.length !== item.byte_count ||
        sha256(value) !== item.audio_sha256
      ) {
        throw new Error(`합성 음원 파일 검증에 실패했습니다: ${item.dictionary_id}`);
      }
      return { item, absolutePath, value };
    }),
  );
  return { ...validated, files };
}
