import { describe, expect, it } from "vitest";

import {
  countEligibleReviewLevels,
  excludePendingReviewCandidates,
  isCandidateInReviewScope,
  mixedAssignmentDatabaseErrorReason,
  orderContiguousPrimaryUnits,
} from "@/lib/admin/mixed-assignment";
import type { EligibleVocabularyEntry } from "@/lib/quiz/eligible-vocabulary";

describe("orderContiguousPrimaryUnits", () => {
  const units = [
    { id: "day-1", unitLabel: "DAY 01", sortIndex: 1 },
    { id: "day-2", unitLabel: "DAY 02", sortIndex: 2 },
    { id: "day-3", unitLabel: "DAY 03", sortIndex: 3 },
  ];

  it("입력 순서와 무관하게 연속 DAY를 정렬한다", () => {
    expect(
      orderContiguousPrimaryUnits(units, ["day-2", "day-1"]),
    ).toEqual(units.slice(0, 2));
  });

  it("중복·누락·비연속 DAY를 거절한다", () => {
    expect(() =>
      orderContiguousPrimaryUnits(units, ["day-1", "day-1"]),
    ).toThrow();
    expect(() =>
      orderContiguousPrimaryUnits(units, ["day-4"]),
    ).toThrow();
    expect(() =>
      orderContiguousPrimaryUnits(units, ["day-1", "day-3"]),
    ).toThrow("연속된 범위");
  });
});

describe("review scope and count", () => {
  const selectedUnits = new Set(["day-2"]);

  it("전체는 같은 단어장 전체, 현재 범위는 선택 단원만 포함한다", () => {
    expect(
      isCandidateInReviewScope("dataset", "day-1", selectedUnits),
    ).toBe(true);
    expect(
      isCandidateInReviewScope("selection", "day-1", selectedUnits),
    ).toBe(false);
    expect(
      isCandidateInReviewScope("selection", "day-2", selectedUnits),
    ).toBe(true);
  });

  it("추가 가능한 고유 행의 전체·1회·2회 이상 수를 나눈다", () => {
    expect(countEligibleReviewLevels([2, 1, 2, 1, 1])).toEqual({
      total: 5,
      level1: 3,
      level2: 2,
    });
  });
});

describe("excludePendingReviewCandidates", () => {
  const candidates: EligibleVocabularyEntry[] = [
    {
      id: 1,
      unitId: "day-1",
      sourceRow: 1,
      headword: "alpha",
      headwordNormalized: "alpha",
      primaryMeaning: "알파",
      canonicalKey: "canonical-a",
      eligibleDirections: ["english_to_korean"],
    },
    {
      id: 2,
      unitId: "day-1",
      sourceRow: 2,
      headword: "alpha variant",
      headwordNormalized: "alpha variant",
      primaryMeaning: "알파 변형",
      canonicalKey: "canonical-a",
      eligibleDirections: ["korean_to_english"],
    },
    {
      id: 3,
      unitId: "day-1",
      sourceRow: 3,
      headword: "beta",
      headwordNormalized: "beta",
      primaryMeaning: "베타",
      canonicalKey: null,
      eligibleDirections: ["english_to_korean"],
    },
  ];

  it("pending의 exact ID와 non-null canonical을 모두 제외한다", () => {
    expect(
      excludePendingReviewCandidates(candidates, [
        { vocabEntryId: 1, canonicalKey: "canonical-a" },
        { vocabEntryId: 3, canonicalKey: null },
      ]),
    ).toEqual([]);
  });

  it("canonical이 없는 pending은 같은 entry ID만 제외한다", () => {
    expect(
      excludePendingReviewCandidates(candidates, [
        { vocabEntryId: 1, canonicalKey: null },
      ]).map((entry) => entry.id),
    ).toEqual([2, 3]);
  });

  it("canonical이 없으면 정규화된 표제어가 같은 항목도 제외한다", () => {
    const duplicateBeta: EligibleVocabularyEntry = {
      ...candidates[2],
      id: 4,
      sourceRow: 4,
      headword: "BETA*",
      headwordNormalized: "beta",
    };

    expect(
      excludePendingReviewCandidates(
        [...candidates, duplicateBeta],
        [
          {
            vocabEntryId: 3,
            canonicalKey: null,
            headword: "beta",
          },
        ],
      ).map((entry) => entry.id),
    ).toEqual([1, 2]);
  });
});

describe("mixedAssignmentDatabaseErrorReason", () => {
  it("대기열·canonical 경합은 새로고침 가능한 충돌로 분류한다", () => {
    expect(
      mixedAssignmentDatabaseErrorReason({
        code: "40001",
        message: "mixed_review_queue_snapshot_changed",
      }),
    ).toBe("conflict");
    expect(
      mixedAssignmentDatabaseErrorReason({
        code: "22023",
        message: "review_target_canonical_mapping_changed",
      }),
    ).toBe("conflict");
    expect(
      mixedAssignmentDatabaseErrorReason({
        code: "22023",
        message: "mixed_regular_target_already_pending_review",
      }),
    ).toBe("conflict");
  });

  it("빈 대기열·권한·잘못된 선택을 구분한다", () => {
    expect(
      mixedAssignmentDatabaseErrorReason({
        code: "22023",
        message: "mixed_review_queue_empty",
      }),
    ).toBe("unavailable");
    expect(
      mixedAssignmentDatabaseErrorReason({
        code: "42501",
        message: "forbidden",
      }),
    ).toBe("forbidden");
    expect(
      mixedAssignmentDatabaseErrorReason({
        code: "22023",
        message: "mixed_primary_units_invalid",
      }),
    ).toBe("invalid_selection");
  });
});
