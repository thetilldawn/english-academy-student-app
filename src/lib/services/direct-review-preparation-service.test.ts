import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  DirectReviewAssignmentInput,
  DirectReviewPreviewInput,
} from "@/lib/admin/direct-review-assignment-request";
import type { DirectReviewCandidate } from "@/lib/admin/direct-review-candidate";
import type { EligibleVocabularyEntry } from "@/lib/quiz/eligible-vocabulary";

import {
  buildDirectReviewSelection,
  DirectReviewPreparationError,
  prepareDirectReviewAssignmentBatch,
  validateDirectReviewSelectionCount,
} from "./direct-review-preparation-service";

const input: DirectReviewPreviewInput = {
  studentId: "11111111-1111-4111-8111-111111111111",
  datasetId: "22222222-2222-4222-8222-222222222222",
  reviewLevels: [1, 2],
  englishToKoreanRatio: 50,
};

function entry(
  id: number,
  overrides: Partial<EligibleVocabularyEntry> = {},
): EligibleVocabularyEntry {
  return {
    id,
    unitId: `unit-${id}`,
    sourceRow: id,
    headword: `word-${id}`,
    headwordNormalized: `word-${id}`,
    primaryMeaning: `뜻-${id}`,
    canonicalDictionaryId: `word:dictionary-${id}`,
    canonicalLexemeId: `lexeme-${id}`,
    canonicalKey: `word:dictionary-${id}`,
    recordType: "word",
    eligibleDirections: ["english_to_korean", "korean_to_english"],
    ...overrides,
  };
}

function candidate(
  target: EligibleVocabularyEntry,
  sourceQuestionId: string,
  reasonLevel: 1 | 2,
  overrides: Partial<DirectReviewCandidate> = {},
): DirectReviewCandidate {
  return {
    sourceQuestionId,
    datasetId: input.datasetId,
    vocabEntryId: target.id,
    canonicalDictionaryId: target.canonicalDictionaryId,
    canonicalLexemeId: target.canonicalLexemeId,
    headwordNormalized: target.headwordNormalized,
    reasonLevel,
    wrongCount: reasonLevel,
    lastWrongAt: "2026-08-24T12:00:00.000Z",
    ...overrides,
  };
}

const allCandidates = Array.from({ length: 6 }, (_, index) => entry(index + 1));

function expectReason(
  reason: DirectReviewPreparationError["reason"],
  action: () => unknown,
) {
  try {
    action();
    throw new Error("오답 준비 오류가 발생해야 합니다.");
  } catch (error) {
    expect(error).toBeInstanceOf(DirectReviewPreparationError);
    expect(error).toMatchObject({ reason });
  }
}

describe("buildDirectReviewSelection", () => {
  it("현재 오답을 출처 순서 그대로 확정하고 단계별 수를 계산한다", () => {
    const selection = buildDirectReviewSelection(
      input,
      [
        candidate(allCandidates[0]!, "question-a", 1),
        candidate(allCandidates[1]!, "question-b", 2),
      ],
      allCandidates,
    );

    expect(selection.sourceQuestionIds).toEqual(["question-a", "question-b"]);
    expect(selection.reviewLevels).toEqual([1, 2]);
    expect(selection.wrongLevel1Eligible).toBe(1);
    expect(selection.wrongLevel2Eligible).toBe(1);
    expect(selection.questions.map((question) => question.vocab_entry_id))
      .toEqual([1, 2]);
    expect(selection.questions).toHaveLength(2);
  });

  it("같은 사전 단어의 여러 오답은 첫 출처 하나만 배정한다", () => {
    const first = allCandidates[0]!;
    const selection = buildDirectReviewSelection(
      input,
      [
        candidate(first, "question-first", 2),
        candidate(first, "question-duplicate", 1, { vocabEntryId: 999 }),
      ],
      allCandidates,
    );

    expect(selection.sourceQuestionIds).toEqual(["question-first"]);
    expect(selection.questions.map((question) => question.vocab_entry_id))
      .toEqual([first.id]);
    expect(selection.wrongLevel1Eligible).toBe(0);
    expect(selection.wrongLevel2Eligible).toBe(1);
  });

  it("단어장·오답 단계가 요청과 다른 후보를 저장 후보로 쓰지 않는다", () => {
    expectReason("conflict", () => buildDirectReviewSelection(
      input,
      [candidate(allCandidates[0]!, "question-a", 1, {
        datasetId: "33333333-3333-4333-8333-333333333333",
      })],
      allCandidates,
    ));
    expectReason("conflict", () => buildDirectReviewSelection(
      { ...input, reviewLevels: [1] },
      [candidate(allCandidates[0]!, "question-a", 2)],
      allCandidates,
    ));
  });

  it("현재 사전 연결이 후보 스냅샷과 다르면 다시 계산하게 한다", () => {
    expectReason("conflict", () => buildDirectReviewSelection(
      input,
      [candidate(allCandidates[0]!, "question-a", 1, {
        canonicalLexemeId: "changed-lexeme",
      })],
      allCandidates,
    ));
  });

  it("현재 방향으로 출제할 수 없는 단어는 미리보기부터 차단한다", () => {
    const englishOnly = entry(1, {
      eligibleDirections: ["english_to_korean"],
    });
    expectReason("invalid_selection", () => buildDirectReviewSelection(
      { ...input, reviewLevels: [1], englishToKoreanRatio: 0 },
      [candidate(englishOnly, "question-a", 1)],
      [englishOnly, ...allCandidates.slice(1)],
    ));
  });

  it("선택 조건에 맞는 현재 오답이 없으면 배정을 만들지 않는다", () => {
    expectReason("unavailable", () => buildDirectReviewSelection(
      input,
      [],
      allCandidates,
    ));
  });

  it("미리보기 뒤 현재 오답 수가 바뀌면 저장을 다시 계산하게 한다", () => {
    const selection = buildDirectReviewSelection(
      input,
      [candidate(allCandidates[0]!, "question-a", 1)],
      allCandidates,
    );

    expectReason("conflict", () =>
      validateDirectReviewSelectionCount(2, selection));
    expect(() => validateDirectReviewSelectionCount(1, selection))
      .not.toThrow();
  });
});

describe("prepareDirectReviewAssignmentBatch", () => {
  it("명령에서 확정한 시각으로 지난 마감을 조회 전에 거부한다", async () => {
    const assignmentInput: DirectReviewAssignmentInput = {
      ...input,
      availableFrom: null,
      availableUntil: "2026-08-28T03:00:00.000Z",
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      passingScore: 80,
      questionOrderMode: "random",
      questionTimeLimitSeconds: null,
      retryEnabled: true,
      retryPassingScore: 80,
      timeLimitSeconds: 300,
      timingMode: "total",
      title: "오답 시험",
      totalQuestionCount: 1,
    };

    await expect(
      prepareDirectReviewAssignmentBatch(
        assignmentInput,
        undefined,
        undefined,
        { nowMilliseconds: Date.parse("2026-08-28T03:00:00.000Z") },
      ),
    ).rejects.toMatchObject({
      fieldPath: "deadline",
      reason: "invalid_selection",
    });
  });
});
