import { createHash } from "node:crypto";

import { z } from "zod";

const HEX20 = /^[0-9a-f]{20}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const DICTIONARY_ID = /^(word|root_affix|expression):[a-z0-9][a-z0-9._'’-]*$/;
const OCCURRENCE_ID = /^occ:[a-z0-9][a-z0-9._-]*$/;
const FINAL_VARIANT_ID = new RegExp(
  `^(?:mw:${HEX20.source.slice(1, -1)}|synthetic:${HEX64.source.slice(1, -1)})$`,
);
const ENGINE_VERSION = "cmudict-hangul-nucleus-align-v3";

const segmentSchema = z
  .object({
    text: z.string().min(1).max(160),
    stress: z.enum(["none", "secondary", "primary"]),
  })
  .strict();

const stressShapeSchema = z
  .object({
    syllable_count: z.int().positive().max(40),
    primary_index: z.int().nonnegative().max(39).nullable(),
    secondary_indexes: z.array(z.int().nonnegative().max(39)).max(20),
  })
  .strict();

const itemSchema = z
  .object({
    dictionary_id: z.string().regex(DICTIONARY_ID),
    headword: z.string().trim().min(1).max(160),
    pronunciation_identity_type: z.enum([
      "webster_selected",
      "webster_repair",
      "synthetic_expression",
      "synthetic_word_surface",
    ]),
    pronunciation_variant_id: z.string().regex(FINAL_VARIANT_ID),
    display_pronunciation_ko: z.string().trim().min(1).max(160),
    segments: z.array(segmentSchema).min(1).max(20),
    derivation_status: z.literal("rule_derived"),
    engine_version: z.literal(ENGINE_VERSION),
    confidence: z.enum(["high", "medium", "low"]),
    confidence_scope: z.literal("hangul_alignment_only"),
    stress_evidence: z.enum([
      "selected_webster_lexical_stress",
      "cmudict_lexical_stress_phrase_rule",
      "cmudict_lexical_stress",
    ]),
    alignment_cost: z.number().nonnegative().max(10),
    alignment_margin: z.number().nonnegative().nullable(),
    webster_mw_notation: z.string().nullable(),
    webster_cmu_primary_match: z.boolean(),
    selected_webster_stress_applied: z.boolean(),
    cmudict_sources: z.array(z.string().min(1).max(200)).min(1).max(20),
    cmudict_stress_shape: stressShapeSchema,
    raw_cmudict_stress_shape: stressShapeSchema,
    source_audio_sha256: z.string().regex(HEX64),
    occurrence_ids: z.array(z.string().regex(OCCURRENCE_ID)).min(1).max(20),
    correction_id: z.string().min(3).max(200).optional(),
    content_sha256: z.string().regex(HEX64),
  })
  .strict()
  .superRefine((item, context) => {
    if (
      item.segments.map(({ text }) => text).join("") !==
      item.display_pronunciation_ko
    ) {
      context.addIssue({
        code: "custom",
        message: "한글 발음 구간을 합친 값이 표시 발음과 다릅니다.",
        path: ["segments"],
      });
    }
    if (
      item.segments.filter(({ stress }) => stress === "primary").length !== 1
    ) {
      context.addIssue({
        code: "custom",
        message: "규칙 생성 발음에는 주강세 구간이 정확히 하나여야 합니다.",
        path: ["segments"],
      });
    }
    if (new Set(item.occurrence_ids).size !== item.occurrence_ids.length) {
      context.addIssue({
        code: "custom",
        message: "한 음원 항목 안에 중복 출현 번호가 있습니다.",
        path: ["occurrence_ids"],
      });
    }
  });

const packageSchema = z
  .object({
    schema_version: z.literal("rule-derived-korean-pronunciation-batch-v1"),
    package_id: z.string().trim().min(3).max(160),
    dataset_key: z.string().trim().min(3).max(200),
    source_exam_package_version: z.string().regex(HEX64),
    status: z.literal("complete"),
    derivation_method: z.literal(
      "cmudict_arpabet_to_hangul_nucleus_alignment",
    ),
    engine_version: z.literal(ENGINE_VERSION),
    confidence_scope: z.literal("hangul_alignment_only"),
    display_semantics: z.literal("lexical_stress_not_tts_acoustic_prosody"),
    target_environment: z.enum(["staging", "production"]),
    generated_at_utc: z.iso.datetime(),
    source_exam_package_sha256: z.string().regex(HEX64),
    source_cmudict_sha256: z.string().regex(HEX64),
    source_cmudict_commit: z.string().regex(HEX40),
    source_corrections_sha256: z.string().regex(HEX64),
    source_expression_manifest_sha256: z.string().regex(HEX64),
    source_word_manifest_sha256: z.string().regex(HEX64),
    source_webster_repair_sha256: z.string().regex(HEX64),
    expected_occurrence_count: z.int().positive().max(2000),
    covered_occurrence_count: z.int().positive().max(2000),
    held_occurrence_count: z.int().nonnegative().max(2000),
    identity_count: z.int().positive().max(1000),
    confidence_occurrence_counts: z
      .object({
        high: z.int().nonnegative(),
        medium: z.int().nonnegative(),
        low: z.int().nonnegative(),
      })
      .strict(),
    stress_evidence_occurrence_counts: z
      .object({
        selected_webster_lexical_stress: z.int().nonnegative(),
        cmudict_lexical_stress_phrase_rule: z.int().nonnegative(),
        cmudict_lexical_stress: z.int().nonnegative(),
      })
      .strict(),
    items: z.array(itemSchema).min(1).max(1000),
    package_version: z.string().regex(HEX64),
  })
  .strict();

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function sha256(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export type RuleDerivedKoreanPronunciationPackage = z.infer<
  typeof packageSchema
>;

export function validateRuleDerivedKoreanPronunciationPackage(input: unknown) {
  const pronunciationPackage = packageSchema.parse(input);
  if (pronunciationPackage.items.length !== pronunciationPackage.identity_count) {
    throw new Error("규칙 생성 발음의 고유 항목 수가 선언값과 다릅니다.");
  }
  if (
    pronunciationPackage.covered_occurrence_count !==
      pronunciationPackage.expected_occurrence_count ||
    pronunciationPackage.held_occurrence_count !== 0
  ) {
    throw new Error("규칙 생성 발음이 시험 출현 전체를 덮지 못했습니다.");
  }

  const identities = pronunciationPackage.items.map(
    (item) => `${item.dictionary_id}\u0000${item.pronunciation_variant_id}`,
  );
  if (new Set(identities).size !== identities.length) {
    throw new Error("규칙 생성 발음에 중복 음원 항목이 있습니다.");
  }

  const occurrenceIds = pronunciationPackage.items.flatMap(
    ({ occurrence_ids }) => occurrence_ids,
  );
  if (
    occurrenceIds.length !== pronunciationPackage.expected_occurrence_count ||
    new Set(occurrenceIds).size !== occurrenceIds.length
  ) {
    throw new Error("규칙 생성 발음의 출현 번호가 누락되거나 중복됐습니다.");
  }

  for (const item of pronunciationPackage.items) {
    const { content_sha256: expectedHash, ...hashInput } = item;
    if (sha256(hashInput) !== expectedHash) {
      throw new Error(`규칙 생성 발음 내용 해시가 다릅니다: ${item.dictionary_id}`);
    }
  }

  const confidenceCounts = pronunciationPackage.items.reduce(
    (counts, item) => {
      counts[item.confidence] += item.occurrence_ids.length;
      return counts;
    },
    { high: 0, medium: 0, low: 0 },
  );
  if (
    Object.entries(confidenceCounts).some(
      ([level, count]) =>
        pronunciationPackage.confidence_occurrence_counts[
          level as keyof typeof confidenceCounts
        ] !== count,
    )
  ) {
    throw new Error("규칙 생성 발음의 신뢰도별 출현 수가 다릅니다.");
  }

  const stressEvidenceCounts = pronunciationPackage.items.reduce(
    (counts, item) => {
      counts[item.stress_evidence] += item.occurrence_ids.length;
      return counts;
    },
    {
      selected_webster_lexical_stress: 0,
      cmudict_lexical_stress_phrase_rule: 0,
      cmudict_lexical_stress: 0,
    },
  );
  if (
    Object.entries(stressEvidenceCounts).some(
      ([evidence, count]) =>
        pronunciationPackage.stress_evidence_occurrence_counts[
          evidence as keyof typeof stressEvidenceCounts
        ] !== count,
    )
  ) {
    throw new Error("규칙 생성 발음의 강세 근거별 출현 수가 다릅니다.");
  }

  const packageHashInput: Partial<RuleDerivedKoreanPronunciationPackage> = {
    ...pronunciationPackage,
  };
  const expectedPackageHash = packageHashInput.package_version;
  delete packageHashInput.generated_at_utc;
  delete packageHashInput.package_version;
  if (sha256(packageHashInput) !== expectedPackageHash) {
    throw new Error("규칙 생성 발음 묶음 해시가 다릅니다.");
  }

  return {
    pronunciationPackage,
    summary: {
      packageId: pronunciationPackage.package_id,
      packageVersion: pronunciationPackage.package_version,
      identityCount: pronunciationPackage.identity_count,
      occurrenceCount: pronunciationPackage.expected_occurrence_count,
      confidenceOccurrenceCounts: confidenceCounts,
      llmTokens: 0,
    },
  };
}
