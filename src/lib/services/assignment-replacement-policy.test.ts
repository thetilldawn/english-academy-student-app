import { describe, expect, it } from "vitest";

import type { AssignmentReplacementInput } from "@/lib/admin/assignment-edit";
import type { EditableSourceContext } from "@/lib/services/assignment-edit-source-service";
import {
  AssignmentReplacementError,
  mapAssignmentReplacementDatabaseFailure,
} from "@/lib/services/assignment-replacement-errors";
import {
  assertExactReviewShape,
  assertLegacyMixedContentShape,
  canReuseSourceQuestions,
} from "@/lib/services/assignment-replacement-policy";

const source: EditableSourceContext = {
  draft: {
    assignmentId: "11111111-1111-4111-8111-111111111111",
    studentId: "22222222-2222-4222-8222-222222222222",
    studentName: "가짜 학생",
    purpose: "review",
    seriesItem: false,
    title: "오답 시험",
    datasetId: "33333333-3333-4333-8333-333333333333",
    primaryUnitIds: ["44444444-4444-4444-8444-444444444444"],
    questionCount: 2,
    englishToKoreanRatio: 50,
    timeLimitSeconds: 300,
    timingMode: "total",
    questionTimeLimitSeconds: null,
    passingScore: 80,
    retryEnabled: true,
    retryPassingScore: 80,
    questionOrderMode: "random",
    availableFrom: null,
    availableUntil: null,
    includePendingReview: true,
    reviewScope: "dataset",
    reviewLevels: [2],
  },
  questions: [
    {
      vocab_entry_id: 10,
      base_order_index: 1,
      direction: "english_to_korean",
      choice_vocab_entry_ids: [10, 11, 12, 13],
    },
    {
      vocab_entry_id: 20,
      base_order_index: 2,
      direction: "korean_to_english",
      choice_vocab_entry_ids: [20, 21, 22, 23],
    },
  ],
  selectedQueueIds: ["queue-1", "queue-2"],
  selectedReviewLevels: [1, 2],
  selectedReviewVocabEntryIds: [10, 20],
};

function replacementInput(
  overrides: Partial<AssignmentReplacementInput> = {},
): AssignmentReplacementInput {
  return {
    idempotencyKey: "55555555-5555-4555-8555-555555555555",
    title: source.draft.title,
    datasetId: source.draft.datasetId,
    primaryUnitIds: source.draft.primaryUnitIds,
    questionCount: source.draft.questionCount,
    englishToKoreanRatio: source.draft.englishToKoreanRatio,
    timeLimitSeconds: source.draft.timeLimitSeconds,
    timingMode: source.draft.timingMode,
    questionTimeLimitSeconds: source.draft.questionTimeLimitSeconds,
    passingScore: source.draft.passingScore,
    retryEnabled: source.draft.retryEnabled,
    retryPassingScore: source.draft.retryPassingScore,
    questionOrderMode: source.draft.questionOrderMode,
    availableFrom: source.draft.availableFrom,
    availableUntil: source.draft.availableUntil,
    includePendingReview: true,
    reviewScope: source.draft.reviewScope,
    reviewLevels: [2],
    ...overrides,
  };
}

describe("assignment replacement policy", () => {
  it("reuses existing questions only while the question identity is unchanged", () => {
    expect(canReuseSourceQuestions(source, replacementInput())).toBe(true);
    expect(
      canReuseSourceQuestions(
        source,
        replacementInput({ englishToKoreanRatio: 100 }),
      ),
    ).toBe(false);
  });

  it("locks an independent review assignment to its original targets", () => {
    expect(() => assertExactReviewShape(source, replacementInput())).not
      .toThrow();
    expect(() =>
      assertExactReviewShape(
        source,
        replacementInput({ questionCount: 1 }),
      ),
    ).toThrowError(AssignmentReplacementError);
    expect(() =>
      assertExactReviewShape(
        source,
        replacementInput({ englishToKoreanRatio: 100 }),
      ),
    ).toThrowError(AssignmentReplacementError);
  });

  it("keeps legacy mixed content fixed while allowing non-content settings", () => {
    const mixedSource: EditableSourceContext = {
      ...source,
      draft: { ...source.draft, purpose: "mixed" },
    };
    expect(() =>
      assertLegacyMixedContentShape(
        mixedSource,
        replacementInput({ passingScore: 90 }),
      )
    ).not.toThrow();
    expect(() =>
      assertLegacyMixedContentShape(
        mixedSource,
        replacementInput({ englishToKoreanRatio: 100 }),
      )
    ).toThrowError(AssignmentReplacementError);
    expect(() =>
      assertLegacyMixedContentShape(
        mixedSource,
        replacementInput({ questionCount: 1 }),
      )
    ).toThrowError(AssignmentReplacementError);
  });

  it.each([
    ["assignment_already_started", "started"],
    ["assignment_already_completed", "completed"],
    ["assignment_already_missed", "missed"],
    ["student_deleted", "deleted"],
    ["snapshot_changed", "conflict"],
    ["vocab_assignment_series_edit_unavailable", "conflict"],
  ] as const)("maps %s to the shared %s error", (message, reason) => {
    expect(
      mapAssignmentReplacementDatabaseFailure({ message }).reason,
    ).toBe(reason);
  });

  it("새 수정본의 지난 마감을 deadline 입력 오류로 보존한다", () => {
    expect(
      mapAssignmentReplacementDatabaseFailure({
        code: "22023",
        message: "assignment_replacement_deadline_elapsed",
      }),
    ).toMatchObject({
      code: "assignment_deadline_elapsed",
      fieldPath: "deadline",
      reason: "invalid_selection",
    });
  });

  it("멱등키 재사용과 원본 변경 충돌 코드를 구분한다", () => {
    expect(
      mapAssignmentReplacementDatabaseFailure({
        message: "idempotency_key_reused",
      }),
    ).toMatchObject({ code: "idempotency_key_reused", reason: "conflict" });
    expect(
      mapAssignmentReplacementDatabaseFailure({ message: "snapshot_changed" }),
    ).toMatchObject({
      code: "assignment_source_changed",
      reason: "conflict",
    });
  });
});
