import { z } from "zod";

const HEX64 = /^[0-9a-f]{64}$/;
const EXPRESSION_ID = /^expression:[a-z0-9][a-z0-9._'’-]*$/;
const SYNTHETIC_ASSET_ID = /^synthetic:[0-9a-f]{64}$/;
const REVIEW_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const SOURCE_AUDIO_PROFILE_ID = "profile:5b6efb0ecc8f4702";

const segmentSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(40)
      .refine((value) => value.trim().length > 0),
    stress: z.enum(["none", "secondary", "primary"]),
  })
  .strict();

const itemSchema = z
  .object({
    dictionary_id: z.string().regex(EXPRESSION_ID),
    headword: z.string().trim().min(1).max(160),
    pronunciation_identity_type: z.literal("synthetic_asset"),
    pronunciation_variant_id: z.string().regex(SYNTHETIC_ASSET_ID),
    display_pronunciation_ko: z.string().trim().min(1).max(160),
    segments: z.array(segmentSchema).min(1).max(20),
    review_status: z.literal("approved"),
    source_content_sha256: z.string().regex(HEX64),
    source_review_run_ids: z
      .array(z.string().regex(REVIEW_RUN_ID))
      .length(2),
    source_review_run_id: z.string().trim().min(3).max(200),
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
    if (!item.segments.some(({ stress }) => stress === "primary")) {
      context.addIssue({
        code: "custom",
        message: "주강세 구간이 하나 이상 필요합니다.",
        path: ["segments"],
      });
    }
    if (new Set(item.source_review_run_ids).size !== 2) {
      context.addIssue({
        code: "custom",
        message: "서로 다른 독립 검토 두 건이 필요합니다.",
        path: ["source_review_run_ids"],
      });
    }
    if (
      item.source_review_run_id !== item.source_review_run_ids.join("+")
    ) {
      context.addIssue({
        code: "custom",
        message: "저장용 검토 번호가 독립 검토 번호와 다릅니다.",
        path: ["source_review_run_id"],
      });
    }
  });

const packageSchema = z
  .object({
    schema_version: z.literal("approved-korean-pronunciation-batch-v1"),
    package_id: z.string().trim().min(3).max(160),
    status: z.literal("approved"),
    review_method: z.literal("independent_double_review_exact_audio"),
    normalization_rule: z.literal("korean_display_segment_v1"),
    source_audio_profile_id: z.literal(SOURCE_AUDIO_PROFILE_ID),
    source_audio_manifest_sha256: z.string().regex(HEX64),
    expected_item_count: z.int().positive().max(500),
    items: z.array(itemSchema).min(1).max(500),
  })
  .strict();

export type ApprovedKoreanPronunciationPackage = z.infer<
  typeof packageSchema
>;
export type ApprovedKoreanPronunciationPackageItem = z.infer<
  typeof itemSchema
>;

export function validateApprovedKoreanPronunciationPackage(input: unknown) {
  const pronunciationPackage = packageSchema.parse(input);
  if (
    pronunciationPackage.items.length !==
    pronunciationPackage.expected_item_count
  ) {
    throw new Error("승인 발음 묶음의 항목 수가 선언값과 다릅니다.");
  }
  const identities = pronunciationPackage.items.map(
    (item) => `${item.dictionary_id}\u0000${item.pronunciation_variant_id}`,
  );
  if (new Set(identities).size !== identities.length) {
    throw new Error("승인 발음 묶음에 중복 음원 항목이 있습니다.");
  }
  return {
    pronunciationPackage,
    summary: {
      packageId: pronunciationPackage.package_id,
      itemCount: pronunciationPackage.items.length,
      profileId: pronunciationPackage.source_audio_profile_id,
      primarySegmentCount: pronunciationPackage.items.reduce(
        (count, item) =>
          count +
          item.segments.filter(({ stress }) => stress === "primary").length,
        0,
      ),
    },
  };
}
