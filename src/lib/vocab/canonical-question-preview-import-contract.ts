import { createHash } from "node:crypto";

import { z } from "zod";

export const CANONICAL_QUESTION_PREVIEW_PROJECT_REF =
  "wojxpruvbjzbhrpmsbuy";
export const CANONICAL_QUESTION_PREVIEW_PACKAGE_FILE_SHA256 =
  "e3a170879e18b233fcd6cd5e740bc0c09fd4a42cbf5d694a226d71159602e28a";
export const CANONICAL_QUESTION_PREVIEW_PACKAGE_CONTENT_HASH =
  "45156c1a74b6ffb32694520899b3a9e4ae22840d61e49b049a1650b337b9e1a0";
export const CANONICAL_QUESTION_PREVIEW_MANIFEST_CONTENT_HASH =
  "b3427ba68fb16f03313ebb5c76a6fe39d2150ac205ab6c917770735124013973";
export const CANONICAL_QUESTION_PREVIEW_ITEM_BINDING_SHA256 =
  "3a5db0dc770f5d8143ed4a35f4d18280da91cdab369b3447b014097e8135da5b";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

const manifestSchema = z.object({
  contract: z.literal("oewn-app-preview-question-manifest-v1"),
  schema_version: z.literal("1.0"),
  policy_version: z.literal("g12-2025-oewn-app-preview-question-v1"),
  package_file_sha256: sha256Schema,
  package_content_hash: sha256Schema,
  content_hash: sha256Schema,
  input_files: z.array(z.object({ sha256: sha256Schema }).passthrough()).length(4),
  safety: z.object({
    target_environment: z.literal("preview"),
    target_project_ref: z.literal(CANONICAL_QUESTION_PREVIEW_PROJECT_REF),
    source_shadow_only: z.literal(true),
    preview_apply_allowed: z.literal(true),
    canonical_approved: z.literal(false),
    release_allowed: z.literal(false),
    production_apply_allowed: z.literal(false),
  }),
  validation: z.object({
    items: z.literal(512),
    unique_question_items: z.literal(512),
    unique_target_modes: z.literal(512),
    unique_source_entries: z.literal(270),
    mode_counts: z.object({
      canonical_definition_to_headword: z.literal(256),
      canonical_example_to_headword: z.literal(256),
    }),
  }),
}).passthrough();

const itemSchema = z.object({
  contract: z.literal("oewn-app-preview-question-item-v1"),
  schema_version: z.literal("1.0"),
  policy_version: z.literal("g12-2025-oewn-app-preview-question-v1"),
  question_item_id: z.string().min(1),
  content_hash: sha256Schema,
  quiz_mode: z.enum([
    "canonical_definition_to_headword",
    "canonical_example_to_headword",
  ]),
  source_entry_ids: z.array(z.string().regex(/^entry-[0-9a-f]{24}$/)).min(1),
  target_definition_item_id: z.string().min(1),
  target_headword: z.string().min(1),
  target_part_of_speech: z.string().min(1),
  prompt_en: z.string().min(1),
  choice_headwords: z.array(z.string().min(1)).length(4),
  correct_choice_index: z.number().int().min(0).max(3),
  required_gates: z.object({
    all_choices_grammar_possible: z.literal(true),
    no_pos_only_elimination: z.literal(true),
    no_synonym_or_form: z.literal(true),
    single_blind_answer: z.literal(true),
  }).strict(),
  safety: z.object({
    target_environment: z.literal("preview"),
    target_project_ref: z.literal(CANONICAL_QUESTION_PREVIEW_PROJECT_REF),
    source_shadow_only: z.literal(true),
    preview_apply_allowed: z.literal(true),
    canonical_approved: z.literal(false),
    release_allowed: z.literal(false),
    production_apply_allowed: z.literal(false),
  }),
}).passthrough();

const EXPECTED_INPUT_HASHES = [
  "034945fd7cb2f8a5aff82532ae66855da0606e7cc2e6bce2461d0d588d567244",
  "048609b211b955891a420a28405c0bf5bdbe6a77420726fb1ca2a32c9a9dc292",
  "2677ac127d53ded7172f70022ba500753ea81a1718bf1a654cfd77732847f0b4",
  "3e7102cdde5d677362014f9a46053d0ea2d2d8e6f08fc92cf9eb048ca85ea2c2",
] as const;

export function sha256Utf8(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function projectRefFromSupabaseUrl(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return hostname.endsWith(".supabase.co")
      ? (hostname.split(".")[0] ?? null)
      : null;
  } catch {
    return null;
  }
}

export function validateCanonicalQuestionPreviewImport(
  manifestInput: unknown,
  itemJsonl: string,
) {
  const manifest = manifestSchema.parse(manifestInput);
  const fileSha256 = sha256Utf8(itemJsonl);
  if (
    fileSha256 !== CANONICAL_QUESTION_PREVIEW_PACKAGE_FILE_SHA256 ||
    manifest.package_file_sha256 !== fileSha256 ||
    manifest.package_content_hash !==
      CANONICAL_QUESTION_PREVIEW_PACKAGE_CONTENT_HASH ||
    manifest.content_hash !==
      CANONICAL_QUESTION_PREVIEW_MANIFEST_CONTENT_HASH
  ) {
    throw new Error("Preview 문제 묶음의 고정 해시가 일치하지 않습니다.");
  }
  const inputHashes = manifest.input_files
    .map((item) => item.sha256)
    .toSorted();
  if (JSON.stringify(inputHashes) !== JSON.stringify(EXPECTED_INPUT_HASHES)) {
    throw new Error("Preview 문제 묶음의 입력 파일 해시가 일치하지 않습니다.");
  }

  const items = itemJsonl
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return itemSchema.parse(JSON.parse(line) as unknown);
      } catch (error) {
        throw new Error(
          `Preview 문제 묶음 ${index + 1}행을 검증하지 못했습니다.`,
          { cause: error },
        );
      }
    });
  const ids = items.map((item) => item.question_item_id);
  const targetModes = items.map((item) =>
    `${item.target_definition_item_id}\u0000${item.quiz_mode}`
  );
  const sourceEntryIds = new Set(items.flatMap((item) => item.source_entry_ids));
  const itemBindingSha256 = sha256Utf8(
    items
      .toSorted((left, right) =>
        left.question_item_id.localeCompare(right.question_item_id, "en")
      )
      .map((item) => `${item.question_item_id}:${item.content_hash}`)
      .join("\n"),
  );
  if (
    items.length !== 512 ||
    new Set(ids).size !== 512 ||
    new Set(targetModes).size !== 512 ||
    sourceEntryIds.size !== 270 ||
    items.filter((item) =>
      item.quiz_mode === "canonical_definition_to_headword"
    ).length !== 256 ||
    items.filter((item) =>
      item.quiz_mode === "canonical_example_to_headword"
    ).length !== 256 ||
    itemBindingSha256 !== CANONICAL_QUESTION_PREVIEW_ITEM_BINDING_SHA256 ||
    items.some((item) =>
      item.choice_headwords[item.correct_choice_index] !== item.target_headword
    )
  ) {
    throw new Error("Preview 문제 묶음의 문항·출처 검증 수치가 일치하지 않습니다.");
  }

  return {
    manifest,
    items,
    summary: {
      itemCount: items.length,
      sourceEntryCount: sourceEntryIds.size,
      packageFileSha256: fileSha256,
      packageContentHash: manifest.package_content_hash,
      manifestContentHash: manifest.content_hash,
      itemBindingSha256,
      targetEnvironment: manifest.safety.target_environment,
      targetProjectRef: manifest.safety.target_project_ref,
    },
  };
}
