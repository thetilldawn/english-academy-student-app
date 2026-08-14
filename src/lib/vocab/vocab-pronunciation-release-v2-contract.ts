import { createHash } from "node:crypto";

import { z } from "zod";

const UPPER_SHA256 = /^[0-9A-F]{64}$/;
const LOWER_SHA256 = /^[0-9a-f]{64}$/;
const IDENTITY_ID = /^pron:v2:[0-9a-f]{64}$/;
const VARIANT_ID = /^(?:mw:[0-9a-f]{20}|synthetic:[0-9a-f]{64})$/;
const OFFICIAL_AUDIO_URL =
  /^https:\/\/media\.merriam-webster\.com\/audio\/prons\/en\/us\/mp3\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.mp3$/;
const DATASET_KEY = "ability-voca-etymology-2025";
const DATASET_SOURCE_SHA256 =
  "9FB5B8307C5E695853E2E0E49DE07DD9CD20D29BC59C749DED4D2D07B4C92133";
const ENGINE_VERSION = "cmudict-arpabet-hangul-render-v1";
const TTS_PROFILE_ID = "profile:75ca7f418d66e6ab";
const TTS_BUCKET = "vocab-pronunciation-audio";
const TTS_PREFIX =
  "pronunciation/google_cloud_text_to_speech/profile-75ca7f418d66e6ab/ability-voca-etymology-2025-v1/";

const nullableText = z.string().trim().min(1).max(500).nullable();
const segmentSchema = z
  .object({
    text: z.string().min(1).max(120),
    stress: z.enum(["none", "secondary", "primary"]),
  })
  .strict();

const identitySchema = z.object({
  identity_id: z.string().regex(IDENTITY_ID),
  headword: z.string().trim().min(1).max(160),
  headword_normalized: z.string().trim().min(1).max(160),
  lexical_pos: nullableText,
  pronunciation_variant_id: z.string().regex(VARIANT_ID),
  audio_provider: z.enum([
    "merriam_webster",
    "google_cloud_text_to_speech",
  ]),
  official_audio_url: z.string().regex(OFFICIAL_AUDIO_URL).nullable(),
  sound_audio: nullableText,
  mw_notation: nullableText,
  storage_bucket: nullableText,
  storage_object_key: nullableText,
  audio_sha256: z.string().regex(LOWER_SHA256).nullable(),
  byte_count: z.number().int().min(128).nullable(),
  profile_id: nullableText,
  request_sha256: z.string().regex(LOWER_SHA256).nullable(),
  model: nullableText,
  voice: nullableText,
  display_pronunciation_ko: z.string().min(1).max(240),
  segments: z.array(segmentSchema).min(1).max(32),
  display_source: z.enum([
    "user_approved_100_identity_v1",
    "deterministic_rule_v1",
  ]),
  engine_version: z.literal(ENGINE_VERSION),
  stress_evidence: z.enum([
    "selected_webster_lexical_stress",
    "cmudict_lexical_stress",
  ]),
  arpabet_phones: z.array(z.string().trim().min(1).max(12)).min(1),
  cmudict_sources: z.array(z.string().trim().min(1).max(500)),
  cmudict_stress_shape: z.object({
    syllable_count: z.number().int().positive(),
    primary_index: z.number().int().nonnegative().nullable(),
    secondary_indexes: z.array(z.number().int().nonnegative()),
  }),
  playback_enabled: z.literal(true),
  display_enabled: z.literal(true),
  approval_evidence: z.record(z.string(), z.unknown()),
  identity_content_sha256: z.string().regex(UPPER_SHA256),
});

const bindingSchema = z.object({
  source_row: z.number().int().min(1).max(3001),
  entry_row_sha256: z.string().regex(UPPER_SHA256),
  headword: z.string().trim().min(1).max(160),
  headword_normalized: z.string().trim().min(1).max(160),
  identity_id: z.string().regex(IDENTITY_ID),
  lexical_pos: nullableText,
  is_entry_default: z.literal(true),
  is_pos_default: z.literal(true),
  selection_rank: z.literal(1),
  selection_basis: z.string().trim().min(1).max(500),
  selection_confidence: z.enum(["approved", "rule_selected"]),
  binding_content_sha256: z.string().regex(UPPER_SHA256),
});

const summarySchema = z.object({
  expected_entry_count: z.literal(3001),
  binding_count: z.literal(3001),
  identity_count: z.number().int().min(1).max(3001),
  webster_binding_count: z.number().int().min(0).max(3001),
  tts_binding_count: z.number().int().min(0).max(3001),
  tts_asset_count: z.number().int().min(0).max(3001),
  playback_missing_count: z.literal(0),
  display_missing_count: z.literal(0),
});

const releaseSchema = z.object({
  schema_version: z.literal("vocab-pronunciation-release-v2"),
  dataset_key: z.literal(DATASET_KEY),
  dataset_source_sha256: z.literal(DATASET_SOURCE_SHA256),
  source_plan_version: z.string().regex(UPPER_SHA256),
  source_tts_manifest_sha256: z.string().regex(UPPER_SHA256),
  engine_version: z.literal(ENGINE_VERSION),
  identities: z.array(identitySchema).min(1),
  bindings: z.array(bindingSchema).length(3001),
  summary: summarySchema,
  package_version: z.string().regex(UPPER_SHA256),
  release_id: z.string().regex(/^voca-release:[0-9a-f]{64}$/),
});

export type VocabPronunciationIdentityV2 = z.infer<typeof identitySchema>;
export type VocabPronunciationBindingV2 = z.infer<typeof bindingSchema>;
export type VocabPronunciationReleaseV2 = z.infer<typeof releaseSchema>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, stableValue(record[key])]),
    );
  }
  return value;
}

export function sha256CanonicalJson(value: unknown, uppercase = true) {
  const hash = createHash("sha256")
    .update(JSON.stringify(stableValue(value)), "utf8")
    .digest("hex");
  return uppercase ? hash.toUpperCase() : hash;
}

export function computeVocabPronunciationIdentityHash(
  value: Record<string, unknown>,
) {
  const hashInput = { ...value };
  delete hashInput.identity_content_sha256;
  return sha256CanonicalJson(hashInput);
}

export function computeVocabPronunciationBindingHash(
  value: Record<string, unknown>,
) {
  const hashInput = { ...value };
  delete hashInput.binding_content_sha256;
  return sha256CanonicalJson(hashInput);
}

export function computeVocabPronunciationPackageVersion(
  value: Record<string, unknown>,
) {
  const hashInput = { ...value };
  delete hashInput.package_version;
  delete hashInput.release_id;
  return sha256CanonicalJson(hashInput);
}

function validateIdentity(identity: VocabPronunciationIdentityV2) {
  const segmentText = identity.segments.map(({ text }) => text).join("");
  const primaryCount = identity.segments.filter(
    ({ stress }) => stress === "primary",
  ).length;
  if (
    segmentText !== identity.display_pronunciation_ko ||
    primaryCount !== 1
  ) {
    throw new Error(`${identity.identity_id} 한글 발음 강세 구간이 다릅니다.`);
  }
  if (
    computeVocabPronunciationIdentityHash(
      identity as unknown as Record<string, unknown>,
    ) !== identity.identity_content_sha256
  ) {
    throw new Error(`${identity.identity_id} 발음 묶음 해시가 다릅니다.`);
  }
  if (identity.audio_provider === "merriam_webster") {
    if (
      !identity.pronunciation_variant_id.startsWith("mw:") ||
      !identity.official_audio_url ||
      !identity.sound_audio ||
      identity.storage_bucket !== null ||
      identity.storage_object_key !== null ||
      identity.audio_sha256 !== null ||
      identity.byte_count !== null ||
      identity.profile_id !== null ||
      identity.request_sha256 !== null ||
      identity.model !== null ||
      identity.voice !== null
    ) {
      throw new Error(`${identity.identity_id} Webster 음원 결속값이 다릅니다.`);
    }
    return;
  }
  const requestHash = identity.request_sha256;
  if (
    !requestHash ||
    identity.pronunciation_variant_id !== `synthetic:${requestHash}` ||
    identity.official_audio_url !== null ||
    identity.sound_audio !== null ||
    identity.mw_notation !== null ||
    identity.storage_bucket !== TTS_BUCKET ||
    identity.storage_object_key !== `${TTS_PREFIX}${requestHash}.mp3` ||
    identity.audio_sha256 === null ||
    identity.byte_count === null ||
    identity.profile_id !== TTS_PROFILE_ID ||
    identity.model !== "chirp3-hd" ||
    identity.voice !== "en-US-Chirp3-HD-Despina"
  ) {
    throw new Error(`${identity.identity_id} Google TTS 음원 결속값이 다릅니다.`);
  }
}

export function validateVocabPronunciationReleaseV2(input: unknown) {
  const release = releaseSchema.parse(input);
  const identities = new Map<string, VocabPronunciationIdentityV2>();
  for (const identity of release.identities) {
    if (identities.has(identity.identity_id)) {
      throw new Error(`${identity.identity_id} 발음 묶음이 중복됐습니다.`);
    }
    validateIdentity(identity);
    identities.set(identity.identity_id, identity);
  }

  const sourceRows = new Set<number>();
  const boundIdentityIds = new Set<string>();
  let websterBindingCount = 0;
  let ttsBindingCount = 0;
  const ttsAssets = new Set<string>();
  for (const binding of release.bindings) {
    if (sourceRows.has(binding.source_row)) {
      throw new Error(`${binding.source_row}번 VOCA 발음 연결이 중복됐습니다.`);
    }
    sourceRows.add(binding.source_row);
    const identity = identities.get(binding.identity_id);
    if (
      !identity ||
      identity.headword_normalized !== binding.headword_normalized ||
      identity.headword !== binding.headword
    ) {
      throw new Error(`${binding.source_row}번 VOCA 발음 묶음 연결이 다릅니다.`);
    }
    if (
      computeVocabPronunciationBindingHash(
        binding as unknown as Record<string, unknown>,
      ) !== binding.binding_content_sha256
    ) {
      throw new Error(`${binding.source_row}번 VOCA 발음 연결 해시가 다릅니다.`);
    }
    boundIdentityIds.add(binding.identity_id);
    if (identity.audio_provider === "merriam_webster") {
      websterBindingCount += 1;
    } else {
      ttsBindingCount += 1;
      if (identity.request_sha256) ttsAssets.add(identity.request_sha256);
    }
  }
  if (
    sourceRows.size !== 3001 ||
    [...sourceRows].some((sourceRow) => sourceRow < 1 || sourceRow > 3001)
  ) {
    throw new Error("VOCA 발음 연결은 1번부터 3,001번까지 정확히 있어야 합니다.");
  }
  if (
    boundIdentityIds.size !== identities.size ||
    [...identities.keys()].some((identityId) => !boundIdentityIds.has(identityId))
  ) {
    throw new Error("사용되지 않거나 누락된 발음 묶음이 있습니다.");
  }
  const actualSummary = {
    expected_entry_count: 3001 as const,
    binding_count: 3001 as const,
    identity_count: identities.size,
    webster_binding_count: websterBindingCount,
    tts_binding_count: ttsBindingCount,
    tts_asset_count: ttsAssets.size,
    playback_missing_count: 0 as const,
    display_missing_count: 0 as const,
  };
  if (JSON.stringify(actualSummary) !== JSON.stringify(release.summary)) {
    throw new Error("VOCA 발음 최종 묶음의 집계가 실제 내용과 다릅니다.");
  }
  const packageVersion = computeVocabPronunciationPackageVersion(
    release as unknown as Record<string, unknown>,
  );
  if (
    packageVersion !== release.package_version ||
    release.release_id !== `voca-release:${packageVersion.toLowerCase()}`
  ) {
    throw new Error("VOCA 발음 최종 묶음의 버전 해시가 다릅니다.");
  }
  return { release, summary: actualSummary };
}

export function vocabPronunciationReleaseHeader(
  release: VocabPronunciationReleaseV2,
) {
  return {
    schema_version: release.schema_version,
    dataset_key: release.dataset_key,
    dataset_source_sha256: release.dataset_source_sha256,
    source_plan_version: release.source_plan_version,
    source_tts_manifest_sha256: release.source_tts_manifest_sha256,
    package_version: release.package_version,
    release_id: release.release_id,
    engine_version: release.engine_version,
    expected_entry_count: release.summary.expected_entry_count,
    expected_identity_count: release.summary.identity_count,
    expected_webster_binding_count: release.summary.webster_binding_count,
    expected_tts_binding_count: release.summary.tts_binding_count,
    expected_tts_asset_count: release.summary.tts_asset_count,
  };
}
