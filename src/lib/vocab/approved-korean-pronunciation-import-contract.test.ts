import { describe, expect, it } from "vitest";

import { validateApprovedKoreanPronunciationPackage } from "@/lib/vocab/approved-korean-pronunciation-import-contract";

function fixture() {
  const assetId = `synthetic:${"1".repeat(64)}`;
  return {
    schema_version: "approved-korean-pronunciation-batch-v1",
    package_id: "expression-stress-canary-v1",
    status: "approved",
    review_method: "independent_double_review_exact_audio",
    normalization_rule: "korean_display_segment_v1",
    source_audio_profile_id: "profile:5b6efb0ecc8f4702",
    source_audio_manifest_sha256: "2".repeat(64),
    expected_item_count: 1,
    items: [
      {
        dictionary_id: "expression:apply-for-4f26363d",
        headword: "apply for",
        pronunciation_identity_type: "synthetic_asset",
        pronunciation_variant_id: assetId,
        display_pronunciation_ko: "어플라이 포어",
        segments: [
          { text: "어플", stress: "none" },
          { text: "라이", stress: "primary" },
          { text: " 포어", stress: "none" },
        ],
        review_status: "approved",
        source_content_sha256: "3".repeat(64),
        source_review_run_ids: ["review-a", "review-b"],
        source_review_run_id: "review-a+review-b",
      },
    ],
  };
}

describe("approved Korean pronunciation import contract", () => {
  it("같은 합성 음원을 독립 검토한 다중 강세 표현을 허용한다", () => {
    expect(validateApprovedKoreanPronunciationPackage(fixture()).summary).toEqual({
      packageId: "expression-stress-canary-v1",
      itemCount: 1,
      profileId: "profile:5b6efb0ecc8f4702",
      primarySegmentCount: 1,
    });
  });

  it("표시 발음과 구간이 다르거나 검토자가 한 명이면 거부한다", () => {
    const value = fixture();
    expect(() =>
      validateApprovedKoreanPronunciationPackage({
        ...value,
        items: [
          {
            ...value.items[0],
            display_pronunciation_ko: "다른 발음",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateApprovedKoreanPronunciationPackage({
        ...value,
        items: [
          {
            ...value.items[0],
            source_review_run_ids: ["review-a", "review-a"],
          },
        ],
      }),
    ).toThrow();
  });

  it("같은 사전 표현과 음원을 중복 등록하면 거부한다", () => {
    const value = fixture();
    expect(() =>
      validateApprovedKoreanPronunciationPackage({
        ...value,
        expected_item_count: 2,
        items: [value.items[0], value.items[0]],
      }),
    ).toThrow("중복 음원");
  });
});
