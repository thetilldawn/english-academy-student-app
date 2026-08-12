import { createHash } from "node:crypto";

import { z } from "zod";

const HEX64_LOWER = /^[0-9a-f]{64}$/;
const HEX64_UPPER = /^[0-9A-F]{64}$/;
const DICTIONARY_ID =
  /^(?:word|root_affix|expression):[a-z0-9][a-z0-9._'’-]*$/;
const OCCURRENCE_ID = /^occ:[a-z0-9][a-z0-9._-]*$/;
const EXAM_REVIEW_ID = /^exam-review:[a-z0-9][a-z0-9._-]*$/;
const OFFICIAL_AUDIO_URL =
  /^https:\/\/media\.merriam-webster\.com\/audio\/prons\/en\/us\/mp3\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.mp3$/;
const SUPABASE_URL = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCTION_PROJECT_REF = "xdxhswjgksukjmpbzqgz";
const PRODUCTION_G12_DATASET_KEY =
  "g12-long-reading-2025-exam-scope-v1";
const PRODUCTION_G12_PACKAGE_VERSION =
  "fc98d9cf6d0a688328234605377d159d50bbc51ba1c689852d657ffc95c77d08";

function boundedText(maximum: number) {
  return z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), {
      message: "앞뒤 공백을 포함할 수 없습니다.",
    });
}

const nullableText = boundedText(500).nullable();
const nullableShortText = boundedText(160).nullable();

const examUseAudioSchema = z
  .object({
  status: z.enum(["raw_attached", "disabled"]),
  audio_url: z.string().url().nullable(),
  sound_audio: nullableText,
  raw_response_sha256: z
    .string()
    .regex(HEX64_LOWER)
    .nullable(),
  raw_source: nullableText,
  raw_relative_path: nullableText,
  reason: z.string().nullable(),
  selection_status: boundedText(160),
  source_locator: nullableText,
  variant_id: nullableShortText,
  variant_pos: nullableShortText,
  mw_notation: nullableText,
  })
  .strict();

const legacyIdSchema = z.object({
  system: z.literal("legacy-word-index"),
  id: z.uuid(),
}).strict();

export const examUseEntrySchema = z.object({
  source_row: z.int().positive(),
  sequence_no: z.int().positive(),
  unit: boundedText(160),
  position_in_unit: z.int().positive(),
  dictionary_id: z.string().regex(DICTIONARY_ID),
  legacy_ids: z.array(legacyIdSchema),
  sense_id: nullableShortText,
  pronunciation_variant_id: nullableShortText,
  display_headword: boundedText(160),
  display_gloss_ko: boundedText(500),
  display_pronunciation_ko: nullableShortText,
  display_pronunciation_review_status: z.enum([
    "candidate",
    "approved",
  ]),
  audio: examUseAudioSchema,
  occurrence_id: z.string().regex(OCCURRENCE_ID),
  occurrence_content_hash: z.string().regex(HEX64_LOWER),
  content_hash: z.string().regex(HEX64_LOWER),
  exam_review_id: z.string().regex(EXAM_REVIEW_ID),
  exam_input_hash: z.string().regex(HEX64_LOWER),
  exam_use_status: z.enum([
    "reviewed_for_preview",
    "review_required",
    "excluded",
  ]),
  context_evidence_status: z.enum([
    "source_entry_context",
    "manual_context_correction",
    "manual_context_invalidation",
    "problem_pdf_unique_match",
    "problem_pdf_multiple_matches",
    "locator_only",
  ]),
  context_evidence: z.record(z.string(), z.unknown()),
  entry_row_sha256: z.string().regex(HEX64_UPPER),
  source_entry_id: boundedText(200),
  source_entry_sha256: z.string().regex(HEX64_LOWER),
  include_in_exam: z.boolean(),
  manual_review_flags: z.array(z.string().min(1)),
  day: z.null(),
}).strict();

export const examUsePackageSchema = z.object({
  schema_version: z.literal("1.0"),
  package_type: z.literal("student-app-exam-use-wordbook"),
  target_environment: z.literal("preview"),
  common_dictionary_release_allowed: z.literal(false),
  exam_use_import_allowed: z.literal(true),
  package_version: z.string().regex(HEX64_LOWER),
  dataset_key: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
  source_sha256: z.string().regex(HEX64_LOWER),
  candidate_dictionary_version: z.string().regex(HEX64_LOWER),
  manifest_content_hash: z.string().regex(HEX64_LOWER),
  exam_review_ledger_sha256: z.string().regex(HEX64_LOWER),
  wordbook_id: boundedText(200),
  title: boundedText(300),
  generated_at_utc: z.iso.datetime(),
  entries: z.array(examUseEntrySchema).min(4),
}).strict();

export type ExamUsePackage = z.infer<typeof examUsePackageSchema>;
export type ExamUseEntry = z.infer<typeof examUseEntrySchema>;

type JsonPrimitive = string | number | boolean | null;
type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        )
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(sortJson(value));
}

export function sha256CanonicalJson(value: JsonValue): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

export function computeExamUsePackageVersion(
  value: Record<string, unknown>,
): string {
  const basis = { ...value };
  delete basis.package_version;
  return sha256CanonicalJson(basis as JsonValue);
}

export function computeExamUseEntryContentHash(
  value: Record<string, unknown>,
): string {
  const basis = structuredClone(value);
  delete basis.content_hash;
  if (Array.isArray(basis.legacy_ids)) {
    basis.legacy_ids = [...basis.legacy_ids].sort((left, right) => {
      const leftJson = canonicalJson(left as JsonValue);
      const rightJson = canonicalJson(right as JsonValue);
      return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
    });
  }
  return sha256CanonicalJson(basis as JsonValue);
}

function requireUnique(
  values: readonly (string | number)[],
  label: string,
) {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} 값이 중복되었습니다.`);
  }
}

function uuidLocations(
  value: unknown,
  path = "",
  result: string[] = [],
): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      uuidLocations(item, `${path}[${index}]`, result),
    );
  } else if (value !== null && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      const child = path ? `${path}.${key}` : key;
      if (typeof item === "string" && UUID.test(item)) {
        if (!/^entries\[\d+\]\.legacy_ids\[\d+\]\.id$/.test(child)) {
          result.push(child);
        }
      } else {
        uuidLocations(item, child, result);
      }
    });
  }
  return result;
}

function validateContextEvidence(entry: ExamUseEntry) {
  const evidence = entry.context_evidence;
  const fail = () => {
    throw new Error(
      `${entry.source_row}번 행의 문맥 근거 계약이 잘못되었습니다.`,
    );
  };
  if (entry.context_evidence_status === "source_entry_context") {
    if (
      evidence.source !== "source_entries" ||
      evidence.source_entry_id !== entry.source_entry_id ||
      evidence.source_entry_sha256 !== entry.source_entry_sha256
    ) {
      fail();
    }
    return;
  }
  if (
    entry.context_evidence_status === "manual_context_correction" ||
    entry.context_evidence_status === "manual_context_invalidation"
  ) {
    if (
      evidence.source !== "semantic_decisions" ||
      typeof evidence.semantic_decisions_sha256 !== "string" ||
      !HEX64_LOWER.test(evidence.semantic_decisions_sha256)
    ) {
      fail();
    }
    return;
  }
  if (
    entry.context_evidence_status === "problem_pdf_unique_match" ||
    entry.context_evidence_status === "problem_pdf_multiple_matches"
  ) {
    const expectedUnique =
      entry.context_evidence_status === "problem_pdf_unique_match";
    if (
      evidence.source !== "problem_pdf" ||
      typeof evidence.content_hash !== "string" ||
      !HEX64_LOWER.test(evidence.content_hash) ||
      typeof evidence.problem_pdf_sha256 !== "string" ||
      !HEX64_LOWER.test(evidence.problem_pdf_sha256) ||
      !Number.isInteger(evidence.problem_page) ||
      (evidence.problem_page as number) < 1 ||
      !Number.isInteger(evidence.match_count) ||
      (expectedUnique
        ? evidence.match_count !== 1
        : (evidence.match_count as number) < 2)
    ) {
      fail();
    }
    return;
  }
  if (
    entry.context_evidence_status === "locator_only" &&
    !["problem_pdf", "source_locator"].includes(
      String(evidence.source ?? ""),
    )
  ) {
    fail();
  }
}

export type ExamUsePackageSummary = {
  packageVersion: string;
  datasetKey: string;
  occurrenceCount: number;
  dictionaryCount: number;
  includedCount: number;
  reviewRequiredCount: number;
  excludedCount: number;
  officialAudioCount: number;
  disabledAudioCount: number;
};

export function validateExamUsePackage(
  input: unknown,
): { package: ExamUsePackage; summary: ExamUsePackageSummary } {
  const parsed = examUsePackageSchema.parse(input);
  if (canonicalJson(input as JsonValue).includes("exam-ready|")) {
    throw new Error("임시 exam-ready 식별자는 가져올 수 없습니다.");
  }
  const leakedUuids = uuidLocations(input);
  if (leakedUuids.length > 0) {
    throw new Error(
      `legacy_ids 밖에 UUID가 있습니다: ${leakedUuids[0]}`,
    );
  }
  const calculatedVersion = computeExamUsePackageVersion(
    input as Record<string, unknown>,
  );
  if (calculatedVersion !== parsed.package_version) {
    throw new Error("시험용 단어장 패키지 해시가 일치하지 않습니다.");
  }

  requireUnique(
    parsed.entries.map((entry) => entry.source_row),
    "source_row",
  );
  requireUnique(
    parsed.entries.map((entry) => entry.sequence_no),
    "sequence_no",
  );
  requireUnique(
    parsed.entries.map((entry) => entry.occurrence_id),
    "occurrence_id",
  );
  requireUnique(
    parsed.entries.map((entry) => entry.exam_review_id),
    "exam_review_id",
  );
  requireUnique(
    parsed.entries.map((entry) => entry.source_entry_id),
    "source_entry_id",
  );
  requireUnique(
    parsed.entries.map(
      (entry) => `${entry.unit}\u0000${entry.position_in_unit}`,
    ),
    "단원 내 순서",
  );

  for (const entry of parsed.entries) {
    requireUnique(
      entry.legacy_ids.map((legacy) => legacy.id),
      `${entry.source_row}번 legacy_id`,
    );
    validateContextEvidence(entry);
    if (
      computeExamUseEntryContentHash(
        entry as unknown as Record<string, unknown>,
      ) !== entry.content_hash
    ) {
      throw new Error(
        `${entry.source_row}번 행의 내용 해시가 일치하지 않습니다.`,
      );
    }
    const contextCanBeUsed = ![
      "manual_context_invalidation",
      "locator_only",
    ].includes(entry.context_evidence_status);
    if (
      entry.include_in_exam &&
      (entry.exam_use_status !== "reviewed_for_preview" ||
        !contextCanBeUsed)
    ) {
      throw new Error(
        `${entry.source_row}번 행은 Preview 출제 검토 상태가 아닙니다.`,
      );
    }
    if (
      !entry.include_in_exam &&
      !["review_required", "excluded"].includes(entry.exam_use_status)
    ) {
      throw new Error(
        `${entry.source_row}번 제외 행의 검토 상태가 잘못되었습니다.`,
      );
    }

    if (entry.audio.status === "raw_attached") {
      if (
        !entry.audio.audio_url ||
        !OFFICIAL_AUDIO_URL.test(entry.audio.audio_url) ||
        !entry.audio.sound_audio ||
        !entry.audio.raw_response_sha256 ||
        !entry.audio.raw_source ||
        !entry.audio.raw_relative_path ||
        !entry.audio.source_locator ||
        !entry.audio.variant_id ||
        !entry.audio.variant_pos ||
        !entry.audio.mw_notation ||
        entry.audio.variant_id !== entry.pronunciation_variant_id ||
        entry.audio.reason !== null
      ) {
        throw new Error(
          `${entry.source_row}번 행의 공식 발음 음원 계약이 잘못되었습니다.`,
        );
      }
    } else if (
      entry.audio.audio_url !== null ||
      entry.audio.sound_audio !== null ||
      entry.pronunciation_variant_id !== null ||
      entry.audio.variant_id !== null ||
      entry.audio.variant_pos !== null ||
      entry.audio.mw_notation !== null ||
      entry.audio.source_locator !== null ||
      !entry.audio.reason
    ) {
      throw new Error(
        `${entry.source_row}번 듣기 비활성 행에 재생 데이터가 남아 있습니다.`,
      );
    }
    const hasRawHash = entry.audio.raw_response_sha256 !== null;
    if (
      hasRawHash !== (entry.audio.raw_source !== null) ||
      hasRawHash !== (entry.audio.raw_relative_path !== null)
    ) {
      throw new Error(
        `${entry.source_row}번 행의 원본 발음 응답 추적값이 불완전합니다.`,
      );
    }
  }

  const includedCount = parsed.entries.filter(
    (entry) => entry.include_in_exam,
  ).length;
  if (includedCount < 4) {
    throw new Error("출제 가능한 단어가 4개보다 적습니다.");
  }

  return {
    package: parsed,
    summary: {
      packageVersion: parsed.package_version,
      datasetKey: parsed.dataset_key,
      occurrenceCount: parsed.entries.length,
      dictionaryCount: new Set(
        parsed.entries.map((entry) => entry.dictionary_id),
      ).size,
      includedCount,
      reviewRequiredCount: parsed.entries.filter(
        (entry) => entry.exam_use_status === "review_required",
      ).length,
      excludedCount: parsed.entries.filter(
        (entry) => entry.exam_use_status === "excluded",
      ).length,
      officialAudioCount: parsed.entries.filter(
        (entry) => entry.audio.status === "raw_attached",
      ).length,
      disabledAudioCount: parsed.entries.filter(
        (entry) => entry.audio.status === "disabled",
      ).length,
    },
  };
}

export function supabaseProjectRef(url: string): string | null {
  return SUPABASE_URL.exec(url.trim())?.[1] ?? null;
}

export function assertPreviewImportEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
) {
  if (environment.VERCEL_ENV === "production") {
    throw new Error("Production 환경에는 시험용 검토본을 가져올 수 없습니다.");
  }
  const url = environment.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const actualRef = supabaseProjectRef(url);
  const expectedRef =
    environment.PREVIEW_EXPECTED_SUPABASE_PROJECT_REF?.trim() ?? "";
  if (!actualRef || !expectedRef || actualRef !== expectedRef) {
    throw new Error(
      "Preview Supabase 프로젝트 ref가 안전장치 값과 일치하지 않습니다.",
    );
  }
  return { supabaseUrl: url, projectRef: actualRef };
}

export function assertExamUseImportEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  examUsePackage: ExamUsePackage,
  expectedProjectRef: string | null,
) {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const actualRef = supabaseProjectRef(url);
  if (
    !actualRef ||
    !expectedProjectRef ||
    actualRef !== expectedProjectRef
  ) {
    throw new Error("Supabase 프로젝트 ref 안전장치가 일치하지 않습니다.");
  }
  if (actualRef === PRODUCTION_PROJECT_REF) {
    if (
      examUsePackage.dataset_key !== PRODUCTION_G12_DATASET_KEY ||
      examUsePackage.package_version !== PRODUCTION_G12_PACKAGE_VERSION
    ) {
      throw new Error(
        "승인된 고3 모의고사 단어장 자료판만 운영 DB에 가져올 수 있습니다.",
      );
    }
    return {
      supabaseUrl: url,
      projectRef: actualRef,
      target: "production_exact_g12" as const,
    };
  }
  if (environment.VERCEL_ENV === "production") {
    throw new Error("Production 환경과 Supabase 프로젝트가 일치하지 않습니다.");
  }
  const previewRef =
    environment.PREVIEW_EXPECTED_SUPABASE_PROJECT_REF?.trim() ?? "";
  if (!previewRef || actualRef !== previewRef) {
    throw new Error(
      "Preview Supabase 프로젝트 ref가 안전장치 값과 일치하지 않습니다.",
    );
  }
  return {
    supabaseUrl: url,
    projectRef: actualRef,
    target: "preview" as const,
  };
}
