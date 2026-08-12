import { createHash } from "node:crypto";

import { z } from "zod";

const SHA256 = /^[0-9A-F]{64}$/;
const OFFICIAL_AUDIO_URL =
  /^https:\/\/media\.merriam-webster\.com\/audio\/prons\/en\/us\/mp3\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.mp3$/;

const nullableText = z.string().trim().min(1).max(500).nullable();

const variantSchema = z.object({
  variant_id: z.string().trim().min(1).max(160),
  locale: z.literal("en-US"),
  pos: nullableText,
  mw_notation: nullableText,
  sound_audio: z.string().trim().min(1).max(160),
  source_locator: nullableText,
  audio_url: z.string().regex(OFFICIAL_AUDIO_URL),
});

const provenanceSchema = z.object({
  raw_response_sha256: z.string().regex(SHA256).nullable(),
  raw_relative_path: nullableText,
  raw_source: nullableText,
  hydrated_file: nullableText.optional(),
});

const entrySchema = z.object({
  source_row: z.number().int().positive(),
  entry_row_sha256: z.string().regex(SHA256),
  headword: z.string().trim().min(1).max(160),
  normalized_headword: z.string().trim().min(1).max(160),
  status: z.enum([
    "raw_first_variant_unreviewed",
    "api_lookup_required",
  ]),
  review_status: z.literal("raw_unreviewed"),
  needs_review: z.boolean(),
  listening_enabled: z.boolean(),
  selected_variant_id: nullableText,
  selected_audio_url: z.string().regex(OFFICIAL_AUDIO_URL).nullable(),
  selected_sound_audio: nullableText,
  selected_pos: nullableText,
  selected_mw_notation: nullableText,
  variants: z.array(variantSchema),
  raw_provenance: z.array(provenanceSchema),
  content_sha256: z.string().regex(SHA256),
});

const packageSchema = z.object({
  schema_version: z.literal("ability-voca-webster-raw-audio-v1"),
  dataset_key: z.literal("ability-voca-etymology-2025"),
  provider: z.literal("merriam_webster"),
  selection_policy: z.literal("first_exact_raw_variant_unreviewed_v1"),
  source_bridge_sha256: z.string().regex(SHA256),
  source_hydrated_sha256: z.array(z.string().regex(SHA256)).min(1),
  summary: z.object({
    total_rows: z.number().int().positive(),
    unique_headwords: z.number().int().positive(),
    playable_rows: z.number().int().nonnegative(),
    playable_unique_headwords: z.number().int().nonnegative(),
    api_lookup_required_rows: z.number().int().nonnegative(),
    needs_review_rows: z.number().int().nonnegative(),
  }),
  entries: z.array(entrySchema),
  package_version: z.string().regex(SHA256),
});

export type VocaPronunciationPackage = z.infer<typeof packageSchema>;
export type VocaPronunciationEntry = z.infer<typeof entrySchema>;

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

export function computeVocaPronunciationEntryHash(
  value: Record<string, unknown>,
) {
  const hashInput = { ...value };
  delete hashInput.content_sha256;
  return sha256Json(hashInput);
}

export function computeVocaPronunciationPackageVersion(
  value: Record<string, unknown>,
) {
  const hashInput = { ...value };
  delete hashInput.package_version;
  return sha256Json(hashInput);
}

export function validateVocaPronunciationPackage(input: unknown) {
  const parsed = packageSchema.parse(input);
  if (parsed.entries.length !== 3001 || parsed.summary.total_rows !== 3001) {
    throw new Error("VOCA 발음 연결 자료는 3,001행이어야 합니다.");
  }
  const sourceRows = new Set<number>();
  const headwords = new Set<string>();
  const playableHeadwords = new Set<string>();
  let playableRows = 0;
  let needsReviewRows = 0;
  for (const entry of parsed.entries) {
    if (sourceRows.has(entry.source_row)) {
      throw new Error(`${entry.source_row}번 출처 행이 중복됐습니다.`);
    }
    sourceRows.add(entry.source_row);
    headwords.add(entry.normalized_headword);
    if (
      computeVocaPronunciationEntryHash(
        entry as unknown as Record<string, unknown>,
      ) !== entry.content_sha256
    ) {
      throw new Error(`${entry.source_row}번 발음 결속 해시가 다릅니다.`);
    }
    const selected = entry.variants.find(
      (variant) =>
        variant.variant_id === entry.selected_variant_id &&
        variant.audio_url === entry.selected_audio_url,
    );
    const urls = new Set(entry.variants.map((variant) => variant.audio_url));
    const positions = new Set(
      entry.variants
        .map((variant) => variant.pos)
        .filter((value): value is string => value !== null),
    );
    const expectedNeedsReview = urls.size > 1 || positions.size > 1;
    if (entry.needs_review !== expectedNeedsReview) {
      throw new Error(`${entry.source_row}번 검토 필요 상태가 다릅니다.`);
    }
    if (entry.needs_review) needsReviewRows += 1;
    if (entry.status === "raw_first_variant_unreviewed") {
      if (!entry.listening_enabled || !selected) {
        throw new Error(`${entry.source_row}번 재생 선택값이 유효하지 않습니다.`);
      }
      playableRows += 1;
      playableHeadwords.add(entry.normalized_headword);
    } else if (
      entry.listening_enabled ||
      entry.selected_variant_id !== null ||
      entry.selected_audio_url !== null ||
      entry.selected_sound_audio !== null ||
      entry.variants.length !== 0
    ) {
      throw new Error(`${entry.source_row}번 API 보충 대기 상태가 다릅니다.`);
    }
  }
  const actualSummary = {
    total_rows: parsed.entries.length,
    unique_headwords: headwords.size,
    playable_rows: playableRows,
    playable_unique_headwords: playableHeadwords.size,
    api_lookup_required_rows: parsed.entries.length - playableRows,
    needs_review_rows: needsReviewRows,
  };
  if (JSON.stringify(actualSummary) !== JSON.stringify(parsed.summary)) {
    throw new Error("VOCA 발음 연결 자료의 집계가 원문과 다릅니다.");
  }
  if (
    computeVocaPronunciationPackageVersion(
      parsed as unknown as Record<string, unknown>,
    ) !== parsed.package_version
  ) {
    throw new Error("VOCA 발음 연결 자료의 패키지 해시가 다릅니다.");
  }
  return { package: parsed, summary: actualSummary };
}
