import { describe, expect, it } from "vitest";

import {
  buildAssignmentSubmission,
  defaultReviewLevels,
  toggleReviewLevel,
} from "@/lib/admin/assignment-submission";

const commonInput = {
  studentId: "11111111-1111-4111-8111-111111111111",
  datasetId: "22222222-2222-4222-8222-222222222222",
  primaryUnitIds: [
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  ],
  title: "",
  questionCount: 10,
  englishToKoreanRatio: 50 as const,
  timeLimitSeconds: 300,
  passingScore: 80,
  questionOrderMode: "random" as const,
  availableUntil: "2026-08-01T10:00:00+09:00",
};

describe("buildAssignmentSubmission", () => {
  it("일반 시험의 기존 endpoint와 payload를 그대로 유지한다", () => {
    expect(
      buildAssignmentSubmission({
        ...commonInput,
        includePendingReview: false,
      }),
    ).toStrictEqual({
      endpoint: "/api/admin/assignments",
      body: {
        title: "",
        datasetId: commonInput.datasetId,
        unitIds: commonInput.primaryUnitIds,
        questionCount: 10,
        englishToKoreanRatio: 50,
        timeLimitSeconds: 300,
        passingScore: 80,
        questionOrderMode: "random",
        availableUntil: "2026-08-01T10:00:00+09:00",
        studentIds: [commonInput.studentId],
      },
    });
  });

  it("혼합 시험은 서버가 허용한 선택 조건만 보낸다", () => {
    const submission = buildAssignmentSubmission({
      ...commonInput,
      includePendingReview: true,
      reviewLevels: [1, 2],
      reviewLimit: 20,
    });

    expect(submission).toStrictEqual({
      endpoint: "/api/admin/mixed-assignments",
      body: {
        studentId: commonInput.studentId,
        datasetId: commonInput.datasetId,
        primaryUnitIds: commonInput.primaryUnitIds,
        reviewLevels: [1, 2],
        reviewLimit: 20,
        totalQuestionCount: 10,
        title: "",
        englishToKoreanRatio: 50,
        timeLimitSeconds: 300,
        passingScore: 80,
        questionOrderMode: "random",
        availableUntil: "2026-08-01T10:00:00+09:00",
      },
    });
    for (const forbiddenKey of [
      "queueIds",
      "selectedQueueIds",
      "reviewQueueIds",
      "questionIds",
      "questions",
      "questionDrafts",
      "supportUnitIds",
      "unitIds",
      "studentIds",
      "assignmentPurpose",
      "reviewDraftId",
      "canonicalLexemeIds",
      "vocabEntryIds",
    ]) {
      expect(submission.body).not.toHaveProperty(forbiddenKey);
    }
  });
});

describe("review level controls", () => {
  it("기본은 두 단계이며 마지막 한 단계는 끌 수 없다", () => {
    expect(defaultReviewLevels()).toEqual([1, 2]);
    expect(toggleReviewLevel([1, 2], 1)).toEqual([2]);
    expect(toggleReviewLevel([2], 2)).toEqual([2]);
    expect(toggleReviewLevel([2], 1)).toEqual([1, 2]);
  });
});
