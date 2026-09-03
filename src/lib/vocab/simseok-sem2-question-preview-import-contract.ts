import { z } from "zod";

import {
  assertSimseokSem2PreviewEnvironment,
  sha256Utf8,
  SIMSEOK_SEM2_EXPECTED_SETS,
  SIMSEOK_SEM2_HANDOFF_CONTENT_HASH,
  SIMSEOK_SEM2_PREVIEW_PROJECT_REF,
  SIMSEOK_SEM2_SOURCE_BUNDLE_MANIFEST_SHA256,
} from "@/lib/vocab/simseok-sem2-preview-import-contract";

export const SIMSEOK_COMBINED_QUESTION_HANDOFF_FILE_SHA256 =
  "625c212c1f2a695bd0878bed9e5ea28bd50338b2692fe055e317a78df51a8ab3";
export const SIMSEOK_COMBINED_QUESTION_HANDOFF_CONTENT_HASH =
  "4482b3379b9f4641d18136ccfab25fa6db206763824813a61aebf68621a8e6ff";

export const SIMSEOK_COMBINED_QUESTION_EXPECTED_SETS = [
  {
    setKey: "g2_l1",
    datasetKey: "simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1",
    packagePath:
      "question-packages/simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1.json",
    packageFileSha256:
      "f45a7ca5825a0b56b0fe52d9a08e2a2062a20bcf8f542f8c8bd46d14e0fa5a74",
    packageContentHash:
      "e1084903fe604e8768392e49bd681228818cec793a8607667c580cd49443c8e6",
    itemBindingSha256:
      "7856e9ebc2d7e91b419b4fc330afe156a13661a3241c8f67f7fd2309f603c84b",
    itemCount: 358,
    expandedCount: 358,
    uniqueTargetCount: 215,
    definitionCount: 188,
    exampleCount: 170,
  },
  {
    setKey: "g2_l2",
    datasetKey: "simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1",
    packagePath:
      "question-packages/simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1.json",
    packageFileSha256:
      "5d0d372258af7ece72a01d76f8b736c7ba18fad6b4bd9c1f6e586902888871af",
    packageContentHash:
      "e127f5ac601944b486c26676000d7cc5fe49a6526bbce16da049bfeabfa4f90d",
    itemBindingSha256:
      "0dfdba61a8f61c155986421f57435ee000f366e1a51b3763bdf3559155805d73",
    itemCount: 206,
    expandedCount: 206,
    uniqueTargetCount: 129,
    definitionCount: 108,
    exampleCount: 98,
  },
  {
    setKey: "g2_mock",
    datasetKey: "simseok-g11-sem2-mid-mock-v1",
    packagePath: "question-packages/simseok-g11-sem2-mid-mock-v1.json",
    packageFileSha256:
      "d64564c96b01c49237cbc496a21d5246154d58e241af73e09be8285ac244cb7e",
    packageContentHash:
      "370ece43b11fc0da2647513e10968aa4930a2fdcadc86a26f94a43c8bce8021c",
    itemBindingSha256:
      "26b194dfa3b2159ed412261604ca61ca300b2b1a2b9f902a44f3cdad7fb0930c",
    itemCount: 191,
    expandedCount: 192,
    uniqueTargetCount: 122,
    definitionCount: 109,
    exampleCount: 82,
  },
  {
    setKey: "g1_l3",
    datasetKey:
      "simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1",
    packagePath:
      "question-packages/simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1.json",
    packageFileSha256:
      "7e048e336d70dfa26282e7a6a5993326a519d04a78521475d3f26acabf557807",
    packageContentHash:
      "95ed65a1fc8c71d89282cf15e6dc2d4d20067db3fe7cb199cfd7206db7ae297d",
    itemBindingSha256:
      "57377db5dabe9687385349ead741a1072e4cb975ad7506333834587c4c755aa0",
    itemCount: 260,
    expandedCount: 260,
    uniqueTargetCount: 151,
    definitionCount: 137,
    exampleCount: 123,
  },
  {
    setKey: "g1_l4",
    datasetKey:
      "simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1",
    packagePath:
      "question-packages/simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1.json",
    packageFileSha256:
      "d3a4a9cb1fa422fc9a32c397bb94a5894ccaa259e0afdc5394ecbc5599b92c13",
    packageContentHash:
      "afddb005bbaf9c1185239673523d50379498b8f6ef4750290f5a623ad5ae7638",
    itemBindingSha256:
      "686a257a31f01c3e8dbfbc39052f5611917e873bc102e24e7a1b3d68b33b16e7",
    itemCount: 214,
    expandedCount: 214,
    uniqueTargetCount: 118,
    definitionCount: 103,
    exampleCount: 111,
  },
  {
    setKey: "g1_adj500",
    datasetKey: "simseok-g10-sem2-mid-adjective-500-v1",
    packagePath:
      "question-packages/simseok-g10-sem2-mid-adjective-500-v1.json",
    packageFileSha256:
      "46c5e9c4c808b0fc35795399fe9c390b0cf3dbe067a59e972418d96c4fea7bed",
    packageContentHash:
      "6ccb895b972897a72043393b3e1ef859d2eb03c8184d874bddd205596692dd57",
    itemBindingSha256:
      "cc76f759312703c0f3ea5f9f71d835d3b3b5eb55d873a24621b5e11649df9301",
    itemCount: 766,
    expandedCount: 766,
    uniqueTargetCount: 483,
    definitionCount: 297,
    exampleCount: 469,
  },
] as const;

const sha256Schema = z.string().regex(/^[0-9A-Fa-f]{64}$/u);
const sourceEntryIdSchema = z.string().regex(/^entry-[0-9a-f]{24}$/u);
const quizModeSchema = z.enum([
  "canonical_definition_to_headword",
  "canonical_example_to_headword",
]);
const safetySchema = z.object({
  target_environment: z.literal("preview"),
  target_project_ref: z.literal(SIMSEOK_SEM2_PREVIEW_PROJECT_REF),
  source_shadow_only: z.literal(true),
  preview_apply_allowed: z.literal(true),
  canonical_approved: z.literal(false),
  release_allowed: z.literal(false),
  production_apply_allowed: z.literal(false),
}).strict();

const itemSchema = z.object({
  contract: z.literal("simseok-combined-app-preview-question-item-v2"),
  schema_version: z.literal("2.0"),
  policy_version: z.literal("simseok-sem2-combined-preview-v2"),
  question_item_id: z.string().min(1),
  content_hash: sha256Schema,
  quiz_mode: quizModeSchema,
  target_definition_item_id: z.string().min(1),
  target_sense_family_id: z.string().min(1),
  target_family_revision_hash: sha256Schema,
  target_headword: z.string().min(1),
  target_part_of_speech: z.enum([
    "noun",
    "verb",
    "adjective",
    "adverb",
    "preposition",
    "conjunction",
    "interjection",
    "determiner",
    "pronoun",
    "other",
  ]),
  target_pos_signature: z.array(z.string().min(1)).min(1),
  prompt_en: z.string().min(1),
  prompt_source_hash: sha256Schema,
  choice_headwords: z.array(z.string().min(1)).length(4),
  choice_source_entry_ids: z.array(sourceEntryIdSchema).length(4),
  correct_choice_index: z.number().int().min(0).max(3),
  source_entry_ids: z.array(sourceEntryIdSchema).min(1),
  source_occurrence_hashes: z.array(sha256Schema).min(1),
  source_definition_content_hash: sha256Schema,
  source_example_content_hash: sha256Schema,
  source_question_content_hash: sha256Schema,
  choice_pool_content_hash: sha256Schema,
  required_gates: z.object({
    bounded_single_answer_heuristic: z.literal(true),
    four_unique_choices: z.literal(true),
    no_synonym_gloss_or_word_family_conflict: z.literal(true),
    prompt_shape_valid: z.literal(true),
    same_part_of_speech_signature: z.literal(true),
  }).strict(),
  review_level: z.literal(
    "source_or_user_authorized_webster_raw_preview_temporary_v1",
  ),
  provenance: z.object({
    target_entry_id: z.string().min(1),
    support_source: z.string().min(1),
    source_bundle_release_boundary: z.literal("preview_temporary_only"),
  }).passthrough(),
  safety: safetySchema,
}).passthrough();

const packageSchema = z.object({
  contract: z.literal("simseok-combined-app-preview-question-package-v2"),
  schema_version: z.literal("2.0"),
  policy_version: z.literal("simseok-sem2-combined-preview-v2"),
  dataset_key: z.string().min(1),
  set_key: z.string().min(1),
  exam_handoff_content_hash: sha256Schema,
  exam_use_package_file_sha256: sha256Schema,
  exam_use_package_version: sha256Schema,
  source_bundle_manifest_sha256: sha256Schema,
  item_binding_sha256: sha256Schema,
  content_hash: sha256Schema,
  items: z.array(itemSchema).min(1),
  validation: z.object({
    items: z.number().int().positive(),
    unique_question_items: z.number().int().positive(),
    expanded_items: z.number().int().positive(),
    unique_target_source_entries: z.number().int().positive(),
    mode_counts: z.object({
      canonical_definition_to_headword: z.number().int().positive(),
      canonical_example_to_headword: z.number().int().positive(),
    }),
    exclusions: z.record(z.string(), z.number().int().nonnegative()),
  }),
  safety: safetySchema,
}).passthrough();

const manifestSetSchema = z.object({
  set_key: z.string().min(1),
  dataset_key: z.string().min(1),
  package_path: z.string().min(1),
  package_file_sha256: sha256Schema,
  package_content_hash: sha256Schema,
  item_binding_sha256: sha256Schema,
  items: z.number().int().positive(),
  expanded_items: z.number().int().positive(),
  unique_target_source_entries: z.number().int().positive(),
  mode_counts: z.object({
    canonical_definition_to_headword: z.number().int().positive(),
    canonical_example_to_headword: z.number().int().positive(),
  }),
}).passthrough();

const manifestSchema = z.object({
  schema_version: z.literal("simseok-sem2-combined-question-handoff-v2"),
  package_contract: z.literal(
    "simseok-combined-app-preview-question-package-v2",
  ),
  item_contract: z.literal("simseok-combined-app-preview-question-item-v2"),
  policy_version: z.literal("simseok-sem2-combined-preview-v2"),
  target_environment: z.literal("preview"),
  target_project_ref: z.literal(SIMSEOK_SEM2_PREVIEW_PROJECT_REF),
  source_shadow_only: z.literal(true),
  preview_apply_allowed: z.literal(true),
  canonical_approved: z.literal(false),
  release_allowed: z.literal(false),
  production_allowed: z.literal(false),
  set_count: z.literal(6),
  item_count: z.literal(1995),
  expanded_item_count: z.literal(1996),
  mode_counts: z.object({
    canonical_definition_to_headword: z.literal(942),
    canonical_example_to_headword: z.literal(1053),
  }),
  source_bundle_manifest_sha256: sha256Schema,
  exam_handoff_content_hash: sha256Schema,
  independent_review: z.object({
    decision: z.literal("omit_rejected_items_without_rewriting_webster_raw"),
    rejected_count: z.literal(265),
    generator_file_sha256: sha256Schema,
    ledger_path: z.literal("independent-review-rejections.json"),
    ledger_file_sha256: sha256Schema,
  }),
  content_hash: sha256Schema,
  sets: z.array(manifestSetSchema).length(6),
}).passthrough();

const reviewLedgerSchema = z.object({
  schema_version: z.literal("simseok-sem2-independent-question-review-v2"),
  generator_file_sha256: sha256Schema,
  decision: z.literal("omit_rejected_items_without_rewriting_webster_raw"),
  rejected_count: z.literal(265),
  rejections: z.array(z.object({
    quiz_mode: quizModeSchema,
    set_key: z.string().min(1),
    target_headword: z.string().min(1),
    reason_code: z.string().min(1),
  })).length(265),
}).passthrough();

function assertSafeRelativePath(value: string) {
  if (
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("심석고 문항 전달 묶음에 안전하지 않은 경로가 있습니다.");
  }
}

export type SimseokCombinedQuestionValidatedPackage = {
  packagePath: string;
  packageFileSha256: string;
  packageText: string;
  package: z.infer<typeof packageSchema>;
};

export function validateSimseokCombinedQuestionPreviewHandoff(
  manifestText: string,
  packageTexts: ReadonlyMap<string, string>,
  reviewLedgerText: string,
) {
  if (
    sha256Utf8(manifestText) !==
    SIMSEOK_COMBINED_QUESTION_HANDOFF_FILE_SHA256
  ) {
    throw new Error("심석고 통합 문항 manifest 파일 해시가 다릅니다.");
  }
  const manifest = manifestSchema.parse(JSON.parse(manifestText) as unknown);
  if (
    manifest.content_hash.toLowerCase() !==
      SIMSEOK_COMBINED_QUESTION_HANDOFF_CONTENT_HASH ||
    manifest.source_bundle_manifest_sha256.toLowerCase() !==
      SIMSEOK_SEM2_SOURCE_BUNDLE_MANIFEST_SHA256 ||
    manifest.exam_handoff_content_hash.toLowerCase() !==
      SIMSEOK_SEM2_HANDOFF_CONTENT_HASH ||
    sha256Utf8(reviewLedgerText) !==
      manifest.independent_review.ledger_file_sha256.toLowerCase()
  ) {
    throw new Error("심석고 통합 문항의 원본·검토 연결 해시가 다릅니다.");
  }
  const reviewLedger = reviewLedgerSchema.parse(
    JSON.parse(reviewLedgerText) as unknown,
  );
  const examSets = new Map(
    SIMSEOK_SEM2_EXPECTED_SETS.map((item) => [item.datasetKey, item]),
  );
  const packages: SimseokCombinedQuestionValidatedPackage[] = [];

  for (const [index, expected] of
    SIMSEOK_COMBINED_QUESTION_EXPECTED_SETS.entries()) {
    const declared = manifest.sets[index];
    assertSafeRelativePath(declared.package_path);
    if (
      declared.set_key !== expected.setKey ||
      declared.dataset_key !== expected.datasetKey ||
      declared.package_path !== expected.packagePath ||
      declared.package_file_sha256.toLowerCase() !==
        expected.packageFileSha256 ||
      declared.package_content_hash.toLowerCase() !==
        expected.packageContentHash ||
      declared.item_binding_sha256.toLowerCase() !==
        expected.itemBindingSha256 ||
      declared.items !== expected.itemCount ||
      declared.expanded_items !== expected.expandedCount ||
      declared.unique_target_source_entries !== expected.uniqueTargetCount ||
      declared.mode_counts.canonical_definition_to_headword !==
        expected.definitionCount ||
      declared.mode_counts.canonical_example_to_headword !==
        expected.exampleCount
    ) {
      throw new Error(`${expected.setKey} 통합 문항 manifest 명세가 다릅니다.`);
    }
    const packageText = packageTexts.get(expected.packagePath);
    if (
      packageText === undefined ||
      sha256Utf8(packageText) !== expected.packageFileSha256
    ) {
      throw new Error(`${expected.setKey} 통합 문항 파일 해시가 다릅니다.`);
    }
    const questionPackage = packageSchema.parse(
      JSON.parse(packageText) as unknown,
    );
    const examSet = examSets.get(expected.datasetKey);
    if (!examSet) {
      throw new Error(`${expected.setKey} 시험 범위 연결이 없습니다.`);
    }
    const itemIds = questionPackage.items.map((item) => item.question_item_id);
    const expandedCount = questionPackage.items.reduce(
      (sum, item) => sum + item.source_entry_ids.length,
      0,
    );
    const targetSourceEntries = new Set(
      questionPackage.items.flatMap((item) => item.source_entry_ids),
    );
    const definitionCount = questionPackage.items.filter(
      (item) => item.quiz_mode === "canonical_definition_to_headword",
    ).length;
    const exampleCount = questionPackage.items.length - definitionCount;
    const itemBinding = sha256Utf8(
      [...questionPackage.items]
        .sort((left, right) =>
          left.quiz_mode.localeCompare(right.quiz_mode, "en") ||
          left.question_item_id.localeCompare(right.question_item_id, "en"),
        )
        .map((item) => `${item.question_item_id}|${item.content_hash.toLowerCase()}`)
        .join("\n"),
    );
    const itemShapeInvalid = questionPackage.items.some((item) => {
      const blankCount = item.prompt_en.split("_____").length - 1;
      return (
        item.source_entry_ids.length !== item.source_occurrence_hashes.length ||
        new Set(item.choice_headwords.map((value) => value.toLocaleLowerCase("en"))).size !== 4 ||
        new Set(item.choice_source_entry_ids).size !== 4 ||
        item.choice_headwords[item.correct_choice_index] !== item.target_headword ||
        !item.source_entry_ids.includes(
          item.choice_source_entry_ids[item.correct_choice_index]!,
        ) ||
        (item.quiz_mode === "canonical_definition_to_headword"
          ? blankCount !== 0
          : blankCount !== 1)
      );
    });
    if (
      questionPackage.dataset_key !== expected.datasetKey ||
      questionPackage.set_key !== expected.setKey ||
      questionPackage.content_hash.toLowerCase() !== expected.packageContentHash ||
      questionPackage.item_binding_sha256.toLowerCase() !== itemBinding ||
      questionPackage.exam_handoff_content_hash.toLowerCase() !==
        SIMSEOK_SEM2_HANDOFF_CONTENT_HASH ||
      questionPackage.source_bundle_manifest_sha256.toLowerCase() !==
        SIMSEOK_SEM2_SOURCE_BUNDLE_MANIFEST_SHA256 ||
      questionPackage.exam_use_package_file_sha256.toLowerCase() !==
        examSet.packageFileSha256 ||
      questionPackage.exam_use_package_version.toLowerCase() !==
        examSet.packageVersion ||
      questionPackage.items.length !== expected.itemCount ||
      new Set(itemIds).size !== expected.itemCount ||
      expandedCount !== expected.expandedCount ||
      targetSourceEntries.size !== expected.uniqueTargetCount ||
      definitionCount !== expected.definitionCount ||
      exampleCount !== expected.exampleCount ||
      questionPackage.validation.items !== expected.itemCount ||
      questionPackage.validation.unique_question_items !== expected.itemCount ||
      questionPackage.validation.expanded_items !== expected.expandedCount ||
      questionPackage.validation.unique_target_source_entries !==
        expected.uniqueTargetCount ||
      questionPackage.validation.mode_counts.canonical_definition_to_headword !==
        expected.definitionCount ||
      questionPackage.validation.mode_counts.canonical_example_to_headword !==
        expected.exampleCount ||
      itemShapeInvalid
    ) {
      throw new Error(`${expected.setKey} 통합 문항 내용 검증 수치가 다릅니다.`);
    }
    packages.push({
      packagePath: expected.packagePath,
      packageFileSha256: expected.packageFileSha256,
      packageText,
      package: questionPackage,
    });
  }
  if (packageTexts.size !== SIMSEOK_COMBINED_QUESTION_EXPECTED_SETS.length) {
    throw new Error("심석고 통합 문항 폴더에 예상하지 않은 파일이 있습니다.");
  }
  return {
    manifest,
    reviewLedger,
    packages,
    summary: {
      setCount: packages.length,
      itemCount: packages.reduce(
        (sum, item) => sum + item.package.items.length,
        0,
      ),
      expandedCount: packages.reduce(
        (sum, item) =>
          sum + item.package.items.reduce(
            (subtotal, question) =>
              subtotal + question.source_entry_ids.length,
            0,
          ),
        0,
      ),
      definitionCount: manifest.mode_counts.canonical_definition_to_headword,
      exampleCount: manifest.mode_counts.canonical_example_to_headword,
      rejectedCount: reviewLedger.rejected_count,
      targetProjectRef: manifest.target_project_ref,
      writes: 0,
    },
  };
}

export { assertSimseokSem2PreviewEnvironment };
