import { describe, expect, it } from "vitest";

import type { AssignmentReplacementInput } from "@/lib/admin/assignment-edit";
import type { EditableSourceContext } from "@/lib/services/assignment-edit-source-service";
import {
  AssignmentReplacementError,
  mapAssignmentReplacementDatabaseFailure,
} from "@/lib/services/assignment-replacement-errors";
import {
  assertExactReviewShape,
  canReuseSourceQuestions,
} from "@/lib/services/assignment-replacement-policy";

const source: EditableSourceContext = {
  draft: {
    assignmentId: "11111111-1111-4111-8111-111111111111",
    studentId: "22222222-2222-4222-8222-222222222222",
    studentName: "가짜 학생",
    purpose: "review",
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
    availableUntil: null,
    includePendingReview: true,
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
    availableUntil: source.draft.availableUntil,
    includePendingReview: true,
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
  });

  it.each([
    ["assignment_already_started", "started"],
    ["assignment_already_completed", "completed"],
    ["assignment_already_missed", "missed"],
    ["student_deleted", "deleted"],
    ["snapshot_changed", "conflict"],
  ] as const)("maps %s to the shared %s error", (message, reason) => {
    expect(
      mapAssignmentReplacementDatabaseFailure({ message }).reason,
    ).toBe(reason);
  });
});
