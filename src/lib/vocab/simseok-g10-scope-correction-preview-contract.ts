import { createHash } from "node:crypto";

import { z } from "zod";

import {
  type ExamUsePackage,
  validateExamUsePackage,
} from "@/lib/vocab/exam-use-import-contract";
import { assertSimseokSem2PreviewEnvironment } from
  "@/lib/vocab/simseok-sem2-preview-import-contract";

export const SIMSEOK_G10_SCOPE_CORRECTION_PREVIEW_PROJECT_REF =
  "wojxpruvbjzbhrpmsbuy";
export const SIMSEOK_G10_SCOPE_CORRECTION_SOURCE_MANIFEST_SHA256 =
  "97732d475fab33c175a47a9b441227c38dadc2f8a5b3c2c3665d9994846f5d72";
export const SIMSEOK_G10_SCOPE_CORRECTION_EXAM_MANIFEST_SHA256 =
  "6586869cfe1bd54d91f601c4502ec37a2f19cff3a59610b3f52955e5b357b87a";
export const SIMSEOK_G10_SCOPE_CORRECTION_EXAM_CONTENT_HASH =
  "4ffc2e1bc3c1fd62747b2564dd948a8520b8693bb7ce965e891b790b7652c977";
export const SIMSEOK_G10_SCOPE_CORRECTION_QUESTION_MANIFEST_SHA256 =
  "49c2ddc367cc04e2eb27b9ea7454a667f9ad75fe2e85ca7c2c4b9c8def7ea2c0";
export const SIMSEOK_G10_SCOPE_CORRECTION_QUESTION_CONTENT_HASH =
  "adb5acfe4d1abb8d69be11c04ef56c820e50598bbed8ac8fe2ad02d6f2fc35af";
export const SIMSEOK_G10_SCOPE_CORRECTION_REVIEW_LEDGER_SHA256 =
  "84e027b5854b1239b55ec62a8ba6100cf4f83e53cde040aecafec0d3b29be6b1";
export const SIMSEOK_G10_SCOPE_CORRECTION_POLICY =
  "simseok-sem2-combined-preview-v3-g1-lessons-1-2";
export const SIMSEOK_G10_SCOPE_STATUS =
  "user_directed_operational_scope_not_officially_confirmed";

export const SIMSEOK_G10_SCOPE_CORRECTION_EXAM_SETS = [
  {
    setKey: "g2_l1",
    datasetKey: "simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1",
    title: "[영어 II] 오선영 1과 단어",
    entryCount: 320,
    packagePath:
      "exam-use-packages/simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1.json",
    packageFileSha256:
      "f1d75a6e221f953a74f3ebbb05f181ec039af2d5807706a37d8e84f5e621a5ca",
    packageVersion:
      "0746d55c6f24b9fdbb8b472825ac36444a6087bd7eda08850838337a4bd4e57b",
    stageForCutover: false,
    initiallyAssignable: true,
  },
  {
    setKey: "g2_l2",
    datasetKey: "simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1",
    title: "[영어 II] 오선영 2과 단어",
    entryCount: 189,
    packagePath:
      "exam-use-packages/simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1.json",
    packageFileSha256:
      "c039311bcfcab629e51754bd4d7737c27f814e05071aa9734663f9fed9812c85",
    packageVersion:
      "61fcc802d9cd7f8935d13c2651c2620c5eaf38734e1c7e60947f97ab3e3e8c29",
    stageForCutover: false,
    initiallyAssignable: true,
  },
  {
    setKey: "g2_mock",
    datasetKey: "simseok-g11-sem2-mid-mock-v1",
    title: "[심석 고2] 2-1 모고 단어",
    entryCount: 278,
    packagePath: "exam-use-packages/simseok-g11-sem2-mid-mock-v1.json",
    packageFileSha256:
      "c14f434e042ec34c039bbebe36849ed3faef3f8df8519cae648318aa1991a020",
    packageVersion:
      "7789a2c559be7f53b2ee6140ab547042b79a48110f5415a13bed5844b87666b0",
    stageForCutover: false,
    initiallyAssignable: true,
  },
  {
    setKey: "g1_l1",
    datasetKey:
      "simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1",
    title: "[공통영어 II] 오선영 1과 단어",
    entryCount: 111,
    packagePath:
      "exam-use-packages/simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1.json",
    packageFileSha256:
      "2bd1365075c0a7d3c4c0c47f397b385e90c0b5ea7d98e8ebf6798d0b2d110a54",
    packageVersion:
      "4e7289e2d750614b057c83e0fef7c503a56f6bf7b80b211ce47621f12906af38",
    stageForCutover: true,
    initiallyAssignable: false,
  },
  {
    setKey: "g1_l2",
    datasetKey:
      "simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1",
    title: "[공통영어 II] 오선영 2과 단어",
    entryCount: 111,
    packagePath:
      "exam-use-packages/simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1.json",
    packageFileSha256:
      "744d4f60b2bf9795f319a942f3ff38b2e276fea031867814039e49237a9ce086",
    packageVersion:
      "5a3d3460bf435c8f6cb3a54934319ebbf89435b864ba9b7ec77b9ca0ce6e28cf",
    stageForCutover: true,
    initiallyAssignable: false,
  },
  {
    setKey: "g1_adj500",
    datasetKey: "simseok-g10-sem2-mid-adjective-500-v1",
    title: "[심석 고1] 2-1 필수 형용사 500",
    entryCount: 500,
    packagePath:
      "exam-use-packages/simseok-g10-sem2-mid-adjective-500-v1.json",
    packageFileSha256:
      "582ab1bedd82b6266e4385abcbf7882f3b9026a8c1b7dc2f3c9ce4feb8ca8e98",
    packageVersion:
      "e077dcd48129f394938b76a0cbfe2a1f65bd95c1742016c5aeee74ecf47696d1",
    stageForCutover: false,
    initiallyAssignable: true,
  },
] as const;

export const SIMSEOK_G10_SCOPE_CORRECTION_QUESTION_SETS = [
  {
    setKey: "g2_l1",
    datasetKey: "simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1",
    packagePath:
      "question-packages/simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1.json",
    packageFileSha256:
      "b4b990cde4cde3f81aae1dfdfa00e59a8cd5134c726b5f1e6b74615a22d0e7a8",
    packageContentHash:
      "1a680172c5323bb239ebd132036314b20faa9aa37bb0b89ea9f86188d66f19d2",
    itemBindingSha256:
      "311acae686a25634a0b10099e557c0abf9712fb34f289ea2ba115b87af3e485a",
    itemCount: 358,
    expandedCount: 358,
    uniqueTargetCount: 215,
    definitionCount: 188,
    exampleCount: 170,
    stageForCutover: false,
  },
  {
    setKey: "g2_l2",
    datasetKey: "simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1",
    packagePath:
      "question-packages/simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1.json",
    packageFileSha256:
      "b560d8ca2568838811d4071dd63a04d412f817bb837b239c2415a63992eb6a82",
    packageContentHash:
      "ed95de886568100679e1314a49a4c8bbc4d17976cdb885808d76ba6a086c4f59",
    itemBindingSha256:
      "d555a7b301e57a3be5d37e9c83b49689c36991bdf8fe1ed6261d62779c5c543a",
    itemCount: 206,
    expandedCount: 206,
    uniqueTargetCount: 129,
    definitionCount: 108,
    exampleCount: 98,
    stageForCutover: false,
  },
  {
    setKey: "g2_mock",
    datasetKey: "simseok-g11-sem2-mid-mock-v1",
    packagePath: "question-packages/simseok-g11-sem2-mid-mock-v1.json",
    packageFileSha256:
      "4c3bcc8ee1c5165dca0b4c27d32640e5fe5b9090c59fb923d63fb43e92f83d8b",
    packageContentHash:
      "cb463d6bad6f98f0512f007bb98ec755ba0b8bb0b868b32f5a4b78ec0ab14471",
    itemBindingSha256:
      "97da1d307664b566e367760b8697c4d498a171bf24638c8c2bb0387e4e466fe2",
    itemCount: 191,
    expandedCount: 192,
    uniqueTargetCount: 122,
    definitionCount: 109,
    exampleCount: 82,
    stageForCutover: false,
  },
  {
    setKey: "g1_l1",
    datasetKey:
      "simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1",
    packagePath:
      "question-packages/simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1.json",
    packageFileSha256:
      "16d754616e2945c603eb0d4c87f68d51ab59b2838bc290363aa23dafc2d98aeb",
    packageContentHash:
      "33496efb466d4c969da2e44de66921638168a7088f11d21c0ad70eebadd64b5a",
    itemBindingSha256:
      "2de8bbcde065ccd0322ea3a0d57af3bed5f518d9588710dbc97b297bcb3252d3",
    itemCount: 117,
    expandedCount: 119,
    uniqueTargetCount: 82,
    definitionCount: 68,
    exampleCount: 49,
    stageForCutover: true,
  },
  {
    setKey: "g1_l2",
    datasetKey:
      "simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1",
    packagePath:
      "question-packages/simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1.json",
    packageFileSha256:
      "536f2beedec9b4a428cd87a11c7c4df310e890905184499e2ce35ffe81088cc5",
    packageContentHash:
      "76385cb902e0352389ec958d75b948d4460a1f79ac97204895a978646791cd54",
    itemBindingSha256:
      "4ffc47956d1f3e02514389c8194ded87f22cf91886298d392f09fadcee6a1693",
    itemCount: 128,
    expandedCount: 130,
    uniqueTargetCount: 86,
    definitionCount: 70,
    exampleCount: 58,
    stageForCutover: true,
  },
  {
    setKey: "g1_adj500",
    datasetKey: "simseok-g10-sem2-mid-adjective-500-v1",
    packagePath:
      "question-packages/simseok-g10-sem2-mid-adjective-500-v1.json",
    packageFileSha256:
      "74f082e5ccd35b4eda2a7046526a0526d5706464c1bbea055e416d31978cc6dd",
    packageContentHash:
      "a7b1299e6929ca46b08b46e36909e459d403c4de65a115c5c1e7b4445bceaf94",
    itemBindingSha256:
      "5ba4ab66d5d0429cf847ffab750b1f70560f6ee7b53cde327a6e761b7d7c93ac",
    itemCount: 766,
    expandedCount: 766,
    uniqueTargetCount: 483,
    definitionCount: 297,
    exampleCount: 469,
    stageForCutover: false,
  },
] as const;

const sha256Schema = z.string().regex(/^[0-9A-Fa-f]{64}$/u);
const sourceEntryIdSchema = z.string().regex(/^entry-[0-9a-f]{24}$/u);
const quizModeSchema = z.enum([
  "canonical_definition_to_headword",
  "canonical_example_to_headword",
]);
const itemSafetySchema = z.object({
  target_environment: z.literal("preview"),
  target_project_ref: z.literal(
    SIMSEOK_G10_SCOPE_CORRECTION_PREVIEW_PROJECT_REF,
  ),
  source_shadow_only: z.literal(true),
  preview_apply_allowed: z.literal(true),
  canonical_approved: z.literal(false),
  release_allowed: z.literal(false),
  production_apply_allowed: z.literal(false),
}).strict();
const packageSafetySchema = itemSafetySchema.extend({
  candidate_only: z.literal(false),
}).strict();

const examManifestSetSchema = z.object({
  set_key: z.string().min(1),
  dataset_key: z.string().min(1),
  display_name: z.string().min(1),
  entry_count: z.number().int().positive(),
  package_path: z.string().min(1),
  package_file_sha256: sha256Schema,
  package_version: sha256Schema,
  unit_counts: z.record(z.string().min(1), z.number().int().positive()),
  catalog: z.object({
    is_assignable: z.boolean(),
    metadata: z.object({
      bundleManifestSha256: sha256Schema,
      productionAllowed: z.literal(false),
      school: z.literal("심석고등학교"),
      schoolYear: z.literal(2026),
      scopeCorrectionPendingCutover: z.boolean(),
      scopeStatus: z.literal(SIMSEOK_G10_SCOPE_STATUS),
      semester: z.literal(2),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

const examManifestSchema = z.object({
  schema_version: z.literal(
    "simseok-sem2-app-handoff-v3-g1-lessons-1-2",
  ),
  target_environment: z.literal("preview"),
  target_project_ref: z.literal(
    SIMSEOK_G10_SCOPE_CORRECTION_PREVIEW_PROJECT_REF,
  ),
  scope_status: z.literal(SIMSEOK_G10_SCOPE_STATUS),
  canonical_approved: z.literal(false),
  production_allowed: z.literal(false),
  source_occurrence_count: z.literal(1509),
  semantic_entry_count: z.literal(1503),
  set_count: z.literal(6),
  source_bundle_manifest_sha256: sha256Schema,
  content_hash: sha256Schema,
  cutover: z.object({
    abort_if_references_are_nonzero: z.literal(true),
    activate_set_keys: z.tuple([z.literal("g1_l1"), z.literal("g1_l2")]),
    retire_dataset_keys: z.tuple([
      z.literal(
        "simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1",
      ),
      z.literal(
        "simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1",
      ),
    ]),
    status: z.literal("pending_after_hidden_import_and_readback"),
  }),
  sets: z.array(examManifestSetSchema).length(6),
}).passthrough();

const questionItemSchema = z.object({
  contract: z.literal("simseok-combined-app-preview-question-item-v2"),
  schema_version: z.literal("2.0"),
  policy_version: z.literal(SIMSEOK_G10_SCOPE_CORRECTION_POLICY),
  question_item_id: z.string().min(1),
  content_hash: sha256Schema,
  quiz_mode: quizModeSchema,
  target_headword: z.string().min(1),
  target_part_of_speech: z.string().min(1),
  target_pos_signature: z.array(z.string().min(1)).min(1),
  prompt_en: z.string().min(1),
  choice_headwords: z.array(z.string().min(1)).length(4),
  choice_source_entry_ids: z.array(sourceEntryIdSchema).length(4),
  correct_choice_index: z.number().int().min(0).max(3),
  source_entry_ids: z.array(sourceEntryIdSchema).min(1),
  source_occurrence_hashes: z.array(sha256Schema).min(1),
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
  safety: itemSafetySchema,
}).passthrough();

const questionPackageSchema = z.object({
  contract: z.literal("simseok-combined-app-preview-question-package-v2"),
  schema_version: z.literal("2.0"),
  policy_version: z.literal(SIMSEOK_G10_SCOPE_CORRECTION_POLICY),
  dataset_key: z.string().min(1),
  set_key: z.string().min(1),
  exam_handoff_content_hash: sha256Schema,
  exam_use_package_file_sha256: sha256Schema,
  exam_use_package_version: sha256Schema,
  source_bundle_manifest_sha256: sha256Schema,
  item_binding_sha256: sha256Schema,
  content_hash: sha256Schema,
  items: z.array(questionItemSchema).min(1),
  validation: z.object({
    items: z.number().int().positive(),
    unique_question_items: z.number().int().positive(),
    expanded_items: z.number().int().positive(),
    unique_target_source_entries: z.number().int().positive(),
    mode_counts: z.object({
      canonical_definition_to_headword: z.number().int().positive(),
      canonical_example_to_headword: z.number().int().positive(),
    }),
  }).passthrough(),
  safety: packageSafetySchema,
}).passthrough();

const questionManifestSetSchema = z.object({
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

const questionManifestSchema = z.object({
  schema_version: z.literal(
    "simseok-sem2-combined-question-handoff-v3-g1-lessons-1-2",
  ),
  package_contract: z.literal(
    "simseok-combined-app-preview-question-package-v2",
  ),
  item_contract: z.literal("simseok-combined-app-preview-question-item-v2"),
  policy_version: z.literal(SIMSEOK_G10_SCOPE_CORRECTION_POLICY),
  target_environment: z.literal("preview"),
  target_project_ref: z.literal(
    SIMSEOK_G10_SCOPE_CORRECTION_PREVIEW_PROJECT_REF,
  ),
  candidate_only: z.literal(false),
  source_shadow_only: z.literal(true),
  preview_apply_allowed: z.literal(true),
  canonical_approved: z.literal(false),
  release_allowed: z.literal(false),
  production_allowed: z.literal(false),
  set_count: z.literal(6),
  item_count: z.literal(1766),
  expanded_item_count: z.literal(1771),
  mode_counts: z.object({
    canonical_definition_to_headword: z.literal(840),
    canonical_example_to_headword: z.literal(926),
  }),
  source_bundle_manifest_sha256: sha256Schema,
  exam_handoff_content_hash: sha256Schema,
  independent_review: z.object({
    decision: z.literal(
      "omit_rejected_items_without_rewriting_source_or_webster_raw",
    ),
    rejected_count: z.literal(372),
    generator_file_sha256: sha256Schema,
    ledger_path: z.literal("independent-review-rejections.json"),
    ledger_file_sha256: sha256Schema,
    new_g1_review_status: z.literal("approved"),
  }),
  content_hash: sha256Schema,
  sets: z.array(questionManifestSetSchema).length(6),
}).passthrough();

const reviewLedgerSchema = z.object({
  decision: z.literal(
    "omit_rejected_items_without_rewriting_source_or_webster_raw",
  ),
  rejected_count: z.literal(372),
  rejections: z.array(z.object({
    reason_code: z.string().min(1),
    set_key: z.string().min(1),
  }).passthrough()).length(372),
}).passthrough();

export type SimseokG10ScopeCorrectionInput = {
  examManifestText: string;
  examPackageTexts: ReadonlyMap<string, string>;
  questionManifestText: string;
  questionPackageTexts: ReadonlyMap<string, string>;
  reviewLedgerText: string;
};

export type ValidatedSimseokG10ScopeCorrectionPackage = {
  setKey: "g1_l1" | "g1_l2";
  datasetKey: string;
  examPackageText: string;
  examPackage: ExamUsePackage;
  questionPackageText: string;
};

export function sha256Utf8(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertSafeRelativePath(value: string) {
  if (
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("심석고 고1 범위 정정 묶음에 안전하지 않은 경로가 있습니다.");
  }
}

export function validateSimseokG10ScopeCorrectionPreview(
  input: SimseokG10ScopeCorrectionInput,
) {
  if (
    sha256Utf8(input.examManifestText) !==
      SIMSEOK_G10_SCOPE_CORRECTION_EXAM_MANIFEST_SHA256 ||
    sha256Utf8(input.questionManifestText) !==
      SIMSEOK_G10_SCOPE_CORRECTION_QUESTION_MANIFEST_SHA256 ||
    sha256Utf8(input.reviewLedgerText) !==
      SIMSEOK_G10_SCOPE_CORRECTION_REVIEW_LEDGER_SHA256
  ) {
    throw new Error("심석고 고1 범위 정정 전달 파일의 고정 해시가 다릅니다.");
  }

  const examManifest = examManifestSchema.parse(
    JSON.parse(input.examManifestText) as unknown,
  );
  const questionManifest = questionManifestSchema.parse(
    JSON.parse(input.questionManifestText) as unknown,
  );
  const reviewLedger = reviewLedgerSchema.parse(
    JSON.parse(input.reviewLedgerText) as unknown,
  );
  if (
    examManifest.content_hash.toLowerCase() !==
      SIMSEOK_G10_SCOPE_CORRECTION_EXAM_CONTENT_HASH ||
    questionManifest.content_hash.toLowerCase() !==
      SIMSEOK_G10_SCOPE_CORRECTION_QUESTION_CONTENT_HASH ||
    examManifest.source_bundle_manifest_sha256.toLowerCase() !==
      SIMSEOK_G10_SCOPE_CORRECTION_SOURCE_MANIFEST_SHA256 ||
    questionManifest.source_bundle_manifest_sha256.toLowerCase() !==
      SIMSEOK_G10_SCOPE_CORRECTION_SOURCE_MANIFEST_SHA256 ||
    questionManifest.exam_handoff_content_hash.toLowerCase() !==
      SIMSEOK_G10_SCOPE_CORRECTION_EXAM_CONTENT_HASH ||
    questionManifest.independent_review.ledger_file_sha256.toLowerCase() !==
      SIMSEOK_G10_SCOPE_CORRECTION_REVIEW_LEDGER_SHA256
  ) {
    throw new Error("심석고 고1 범위 정정 묶음의 연결 해시가 다릅니다.");
  }

  const validatedExamPackages = new Map<string, {
    packageText: string;
    package: ExamUsePackage;
  }>();
  for (const [index, expected] of
    SIMSEOK_G10_SCOPE_CORRECTION_EXAM_SETS.entries()) {
    const declared = examManifest.sets[index];
    assertSafeRelativePath(declared.package_path);
    if (
      declared.set_key !== expected.setKey ||
      declared.dataset_key !== expected.datasetKey ||
      declared.display_name !== expected.title ||
      declared.entry_count !== expected.entryCount ||
      declared.package_path !== expected.packagePath ||
      declared.package_file_sha256.toLowerCase() !==
        expected.packageFileSha256 ||
      declared.package_version.toLowerCase() !== expected.packageVersion ||
      declared.catalog.is_assignable !== expected.initiallyAssignable ||
      declared.catalog.metadata.scopeCorrectionPendingCutover !==
        expected.stageForCutover ||
      declared.catalog.metadata.bundleManifestSha256.toLowerCase() !==
        SIMSEOK_G10_SCOPE_CORRECTION_SOURCE_MANIFEST_SHA256
    ) {
      throw new Error(`${expected.setKey} 시험 범위 고정 명세가 다릅니다.`);
    }
    const packageText = input.examPackageTexts.get(expected.packagePath);
    if (
      packageText === undefined ||
      sha256Utf8(packageText) !== expected.packageFileSha256
    ) {
      throw new Error(`${expected.setKey} 시험 범위 패키지 해시가 다릅니다.`);
    }
    const validated = validateExamUsePackage(JSON.parse(packageText) as unknown);
    const actualUnitCounts = Object.fromEntries(
      [...new Set(validated.package.entries.map((entry) => entry.unit))].map(
        (unit) => [
          unit,
          validated.package.entries.filter((entry) => entry.unit === unit).length,
        ],
      ),
    );
    if (
      validated.package.dataset_key !== expected.datasetKey ||
      validated.package.title !== expected.title ||
      validated.package.package_version !== expected.packageVersion ||
      validated.summary.occurrenceCount !== expected.entryCount ||
      validated.summary.includedCount !== expected.entryCount ||
      validated.summary.reviewRequiredCount !== 0 ||
      validated.summary.excludedCount !== 0 ||
      JSON.stringify(actualUnitCounts) !== JSON.stringify(declared.unit_counts)
    ) {
      throw new Error(`${expected.setKey} 시험 범위 패키지 수치가 다릅니다.`);
    }
    validatedExamPackages.set(expected.setKey, {
      packageText,
      package: validated.package,
    });
  }
  if (
    input.examPackageTexts.size !==
    SIMSEOK_G10_SCOPE_CORRECTION_EXAM_SETS.length
  ) {
    throw new Error("시험 범위 폴더에 예상하지 않은 파일이 있습니다.");
  }

  const stagedPackages: ValidatedSimseokG10ScopeCorrectionPackage[] = [];
  for (const [index, expected] of
    SIMSEOK_G10_SCOPE_CORRECTION_QUESTION_SETS.entries()) {
    const declared = questionManifest.sets[index];
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
      declared.mode_counts.canonical_example_to_headword !== expected.exampleCount
    ) {
      throw new Error(`${expected.setKey} 통합 문항 고정 명세가 다릅니다.`);
    }
    const packageText = input.questionPackageTexts.get(expected.packagePath);
    if (
      packageText === undefined ||
      sha256Utf8(packageText) !== expected.packageFileSha256
    ) {
      throw new Error(`${expected.setKey} 통합 문항 패키지 해시가 다릅니다.`);
    }
    const questionPackage = questionPackageSchema.parse(
      JSON.parse(packageText) as unknown,
    );
    const examExpected = SIMSEOK_G10_SCOPE_CORRECTION_EXAM_SETS.find(
      (item) => item.setKey === expected.setKey,
    );
    const examPackage = validatedExamPackages.get(expected.setKey);
    if (!examExpected || !examPackage) {
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
    const itemBinding = sha256Utf8(
      [...questionPackage.items]
        .sort((left, right) =>
          left.quiz_mode.localeCompare(right.quiz_mode, "en") ||
          left.question_item_id.localeCompare(right.question_item_id, "en"),
        )
        .map((item) => `${item.question_item_id}|${item.content_hash.toLowerCase()}`)
        .join("\n"),
    );
    const invalidItem = questionPackage.items.some((item) => {
      const blankCount = item.prompt_en.split("_____").length - 1;
      return (
        item.source_entry_ids.length !== item.source_occurrence_hashes.length ||
        new Set(item.choice_headwords.map((value) => value.toLowerCase())).size !== 4 ||
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
        SIMSEOK_G10_SCOPE_CORRECTION_EXAM_CONTENT_HASH ||
      questionPackage.source_bundle_manifest_sha256.toLowerCase() !==
        SIMSEOK_G10_SCOPE_CORRECTION_SOURCE_MANIFEST_SHA256 ||
      questionPackage.exam_use_package_file_sha256.toLowerCase() !==
        examExpected.packageFileSha256 ||
      questionPackage.exam_use_package_version.toLowerCase() !==
        examExpected.packageVersion ||
      questionPackage.items.length !== expected.itemCount ||
      new Set(itemIds).size !== expected.itemCount ||
      expandedCount !== expected.expandedCount ||
      targetSourceEntries.size !== expected.uniqueTargetCount ||
      definitionCount !== expected.definitionCount ||
      questionPackage.items.length - definitionCount !== expected.exampleCount ||
      questionPackage.validation.items !== expected.itemCount ||
      questionPackage.validation.unique_question_items !== expected.itemCount ||
      questionPackage.validation.expanded_items !== expected.expandedCount ||
      questionPackage.validation.unique_target_source_entries !==
        expected.uniqueTargetCount ||
      questionPackage.validation.mode_counts.canonical_definition_to_headword !==
        expected.definitionCount ||
      questionPackage.validation.mode_counts.canonical_example_to_headword !==
        expected.exampleCount ||
      invalidItem
    ) {
      throw new Error(`${expected.setKey} 통합 문항 패키지 수치가 다릅니다.`);
    }
    if (expected.stageForCutover) {
      stagedPackages.push({
        setKey: expected.setKey,
        datasetKey: expected.datasetKey,
        examPackageText: examPackage.packageText,
        examPackage: examPackage.package,
        questionPackageText: packageText,
      });
    }
  }
  if (
    input.questionPackageTexts.size !==
    SIMSEOK_G10_SCOPE_CORRECTION_QUESTION_SETS.length
  ) {
    throw new Error("통합 문항 폴더에 예상하지 않은 파일이 있습니다.");
  }
  if (
    stagedPackages.length !== 2 ||
    stagedPackages[0]?.setKey !== "g1_l1" ||
    stagedPackages[1]?.setKey !== "g1_l2"
  ) {
    throw new Error("고1 1·2과 단계 반영 목록이 다릅니다.");
  }

  return {
    examManifest,
    questionManifest,
    reviewLedger,
    stagedPackages,
    summary: {
      validatedSetCount: 6,
      stagedSetCount: 2,
      sourceOccurrenceCount: 1509,
      stagedOccurrenceCount: 222,
      questionItemCount: 1766,
      expandedQuestionCount: 1771,
      stagedQuestionItemCount: 245,
      stagedExpandedQuestionCount: 249,
      definitionCount: 840,
      exampleCount: 926,
      targetProjectRef: SIMSEOK_G10_SCOPE_CORRECTION_PREVIEW_PROJECT_REF,
      writes: 0,
    },
  };
}

export { assertSimseokSem2PreviewEnvironment as assertSimseokG10ScopeCorrectionPreviewEnvironment };
