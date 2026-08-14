import { createHash } from "node:crypto";

import { z } from "zod";

const UPPER_SHA256 = /^[0-9A-F]{64}$/;
const LOWER_SHA256 = /^[0-9a-f]{64}$/;
const WORD_ID = /^word:[a-z0-9][a-z0-9._'’-]*$/;
const OCCURRENCE_ID = /^occ:[a-z0-9][a-z0-9._-]*$/;
const OFFICIAL_AUDIO_URL =
  /^https:\/\/media\.merriam-webster\.com\/audio\/prons\/en\/us\/mp3\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.mp3$/;

const nullableText = z.string().trim().min(1).max(500).nullable();

const variantSchema = z
  .object({
    variant_id: z.string().trim().min(1).max(160),
    locale: z.literal("en-US"),
    pos: nullableText,
    mw_notation: nullableText,
    sound_audio: z.string().trim().min(1).max(160),
    source_locator: nullableText,
    audio_url: z.string().regex(OFFICIAL_AUDIO_URL),
  })
  .strict();

const provenanceSchema = z
  .object({
    raw_response_sha256: z.string().regex(LOWER_SHA256).nullable(),
    raw_relative_path: nullableText,
    raw_source: nullableText,
    decision: z.literal("cross_pos_same_pronunciation_webster_reuse"),
    pronunciation_comparison: z.literal(
      "webster_and_cmudict_same_pronunciation",
    ),
  })
  .strict();

const entrySchema = z
  .object({
    occurrence_id: z.string().regex(OCCURRENCE_ID),
    dictionary_id: z.string().regex(WORD_ID),
    source_row: z.int().positive(),
    entry_row_sha256: z.string().regex(UPPER_SHA256),
    headword_normalized: z.string().trim().min(1).max(160),
    selected_variant_id: z.string().trim().min(1).max(160),
    selected_audio_url: z.string().regex(OFFICIAL_AUDIO_URL),
    selected_sound_audio: z.string().trim().min(1).max(160),
    selected_pos: nullableText,
    selected_mw_notation: nullableText,
    variants: z.array(variantSchema).min(1),
    raw_provenance: z.array(provenanceSchema).min(1),
    content_sha256: z.string().regex(UPPER_SHA256),
  })
  .strict();

const packageSchema = z
  .object({
    schema_version: z.literal("exam-webster-same-pronunciation-repair-v1"),
    generated_at_utc: z.iso.datetime(),
    dataset_key: z.literal("g12-long-reading-2025-exam-scope-v1"),
    source_exam_package_version: z.string().regex(LOWER_SHA256),
    source_exam_package_sha256: z.string().regex(LOWER_SHA256),
    source_decisions_sha256: z.string().regex(LOWER_SHA256),
    source_hydrated_sha256: z.string().regex(LOWER_SHA256),
    provider: z.literal("merriam_webster"),
    decision_policy: z.literal(
      "cross_pos_reuse_only_when_standard_american_pronunciation_matches_v1",
    ),
    status: z.literal("complete"),
    app_release_allowed: z.literal(true),
    expected_dictionary_count: z.literal(28),
    expected_occurrence_count: z.literal(29),
    entries: z.array(entrySchema).length(29),
    summary: z
      .object({
        dictionary_count: z.literal(28),
        occurrence_count: z.literal(29),
        soil_occurrence_count: z.literal(2),
      })
      .strict(),
    package_version: z.string().regex(UPPER_SHA256),
  })
  .strict();

export type ExamWebsterPronunciationRepairPackage = z.infer<
  typeof packageSchema
>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function sha256Json(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)), "utf8")
    .digest("hex")
    .toUpperCase();
}

export function computeExamWebsterRepairEntryHash(
  value: Record<string, unknown>,
) {
  const hashInput = { ...value };
  delete hashInput.content_sha256;
  return sha256Json(hashInput);
}

export function computeExamWebsterRepairPackageVersion(
  value: Record<string, unknown>,
) {
  const hashInput = { ...value };
  delete hashInput.package_version;
  delete hashInput.generated_at_utc;
  return sha256Json(hashInput);
}

export function validateExamWebsterPronunciationRepairPackage(input: unknown) {
  const parsed = packageSchema.parse(input);
  const occurrenceIds = new Set<string>();
  const dictionaryIds = new Set<string>();
  let soilOccurrenceCount = 0;
  for (const entry of parsed.entries) {
    if (occurrenceIds.has(entry.occurrence_id)) {
      throw new Error("Webster 복구 자료에 중복 출현 ID가 있습니다.");
    }
    occurrenceIds.add(entry.occurrence_id);
    dictionaryIds.add(entry.dictionary_id);
    if (entry.dictionary_id === "word:soil") soilOccurrenceCount += 1;
    if (
      computeExamWebsterRepairEntryHash(
        entry as unknown as Record<string, unknown>,
      ) !== entry.content_sha256 ||
      !entry.variants.some(
        (variant) =>
          variant.variant_id === entry.selected_variant_id &&
          variant.audio_url === entry.selected_audio_url &&
          variant.sound_audio === entry.selected_sound_audio &&
          variant.pos === entry.selected_pos &&
          variant.mw_notation === entry.selected_mw_notation,
      )
    ) {
      throw new Error(`Webster 복구 결속값이 다릅니다: ${entry.occurrence_id}`);
    }
  }
  if (
    dictionaryIds.size !== 28 ||
    occurrenceIds.size !== 29 ||
    soilOccurrenceCount !== 2 ||
    computeExamWebsterRepairPackageVersion(
      parsed as unknown as Record<string, unknown>,
    ) !== parsed.package_version
  ) {
    throw new Error("Webster 복구 자료 집계나 패키지 해시가 다릅니다.");
  }
  return {
    package: parsed,
    summary: {
      dictionaryCount: dictionaryIds.size,
      occurrenceCount: occurrenceIds.size,
      soilOccurrenceCount,
      packageVersion: parsed.package_version,
    },
  };
}
