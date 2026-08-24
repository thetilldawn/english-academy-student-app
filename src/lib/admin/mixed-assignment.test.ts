import { describe, expect, it } from "vitest";

import {
  countEligibleReviewLevels,
  excludePendingReviewCandidates,
  isCandidateInReviewScope,
  mixedAssignmentDatabaseErrorReason,
  mixedAssignmentGeneratedTitle,
  mixedAssignmentPrimaryUnitIds,
  orderContiguousPrimaryUnits,
  resolvePendingReviewCandidate,
} from "@/lib/admin/mixed-assignment";
import type { EligibleVocabularyEntry } from "@/lib/quiz/eligible-vocabulary";

describe("orderContiguousPrimaryUnits", () => {
  const units = [
    { id: "day-1", unitLabel: "DAY 01", sortIndex: 1 },
    { id: "day-2", unitLabel: "DAY 02", sortIndex: 2 },
    { id: "day-3", unitLabel: "DAY 03", sortIndex: 3 },
  ];

  it("교사가 고른 연속 DAY의 방향을 그대로 유지한다", () => {
    expect(
      orderContiguousPrimaryUnits(units, ["day-2", "day-1"]),
    ).toEqual([units[1], units[0]]);
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
    ).toThrow("연속 범위");
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

describe("mixedAssignmentPrimaryUnitIds", () => {
  it("오답만으로 문항을 채우면 일반 단원 범위를 RPC에 보내지 않는다", () => {
    expect(mixedAssignmentPrimaryUnitIds(["day-9"], 7, 7)).toEqual([]);
  });

  it("일반 단어가 섞이면 선택한 단원 범위를 유지한다", () => {
    expect(mixedAssignmentPrimaryUnitIds(["day-9"], 3, 10)).toEqual([
      "day-9",
    ]);
  });
});

describe("mixedAssignmentGeneratedTitle", () => {
  const units = [
    { id: "day-9", unitLabel: "DAY 09", sortIndex: 9 },
  ];

  it("오답만 배정하면 선택 DAY를 제목에 노출하지 않는다", () => {
    expect(
      mixedAssignmentGeneratedTitle("능률 VOCA", units, 7, 7),
    ).toBe("능률 VOCA · 오답 시험 · 7문항");
  });

  it("일반 단어가 섞이면 선택 범위와 오답 수를 유지한다", () => {
    expect(
      mixedAssignmentGeneratedTitle("능률 VOCA", units, 3, 10),
    ).toBe("능률 VOCA · DAY 09 · 틀렸던 단어 3개 포함");
  });

  it("띄어 고른 범위를 선택하지 않은 중간 DAY까지로 쓰지 않는다", () => {
    expect(
      mixedAssignmentGeneratedTitle(
        "능률 VOCA",
        [
          { id: "day-1", unitLabel: "DAY 01", sortIndex: 1 },
          { id: "day-3", unitLabel: "DAY 03", sortIndex: 3 },
        ],
        3,
        10,
      ),
    ).toBe("능률 VOCA · DAY 01 외 1개 · 틀렸던 단어 3개 포함");
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
      canonicalDictionaryId: null,
      canonicalLexemeId: "canonical-a",
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
      canonicalDictionaryId: null,
      canonicalLexemeId: "canonical-a",
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
      canonicalDictionaryId: null,
      canonicalLexemeId: null,
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

describe("resolvePendingReviewCandidate", () => {
  const candidates: EligibleVocabularyEntry[] = [
    {
      id: 20,
      unitId: "day-2",
      sourceRow: 20,
      headword: "observe",
      headwordNormalized: "observe",
      primaryMeaning: "준수하다",
      canonicalDictionaryId: "word:observe",
      canonicalLexemeId: null,
      canonicalKey: "word:observe",
      recordType: "word",
      eligibleDirections: ["english_to_korean"],
    },
    {
      id: 10,
      unitId: "day-1",
      sourceRow: 10,
      headword: "observe",
      headwordNormalized: "observe",
      primaryMeaning: "관찰하다",
      canonicalDictionaryId: "word:observe",
      canonicalLexemeId: null,
      canonicalKey: "word:observe",
      recordType: "word",
      eligibleDirections: ["english_to_korean"],
    },
  ];

  it("keeps the dictionary identity when the current release uses another occurrence", () => {
    const pending = {
      vocabEntryId: 999,
      canonicalDictionaryId: "word:observe",
      canonicalLexemeId: null,
    };

    expect(
      resolvePendingReviewCandidate(
        candidates,
        pending,
        "dataset",
        new Set(),
      )?.id,
    ).toBe(10);
    expect(
      resolvePendingReviewCandidate(
        candidates,
        pending,
        "selection",
        new Set(["day-2"]),
      )?.id,
    ).toBe(20);
  });

  it("does not let an entry fallback override conflicting dictionary IDs", () => {
    expect(
      resolvePendingReviewCandidate(
        candidates,
        {
          vocabEntryId: 10,
          canonicalDictionaryId: "word:different",
          canonicalLexemeId: null,
        },
        "dataset",
        new Set(),
      ),
    ).toBeUndefined();
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
