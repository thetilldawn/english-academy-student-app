import { describe, expect, it } from "vitest";

import { assignmentContractIds } from "@/test-support/assignment-contract-fixtures";

import { reduceSingleAssignmentDraft } from "../domain/single-draft";
import { InvalidAssignmentDraftError } from "../domain/validation";
import { hydrateSingleAssignmentDraftFromEditResponse } from "./edit-draft-adapter";

const baseResponse = {
  assignmentId: assignmentContractIds.day57,
  studentId: assignmentContractIds.studentA,
  studentName: "검증 학생",
  purpose: "regular" as const,
  title: "기존 시험 제목",
  datasetId: assignmentContractIds.dataset,
  primaryUnitIds: [assignmentContractIds.day60],
  questionCount: 20,
  englishToKoreanRatio: 50 as const,
  timeLimitSeconds: 300,
  timingMode: "total" as const,
  questionTimeLimitSeconds: null,
  passingScore: 80,
  retryEnabled: true,
  retryPassingScore: 80,
  questionOrderMode: "fixed" as const,
  availableFrom: "2026-08-17T03:00:00.000Z",
  availableUntil: "2026-08-18T12:00:00.000Z",
  includePendingReview: false,
  reviewScope: "dataset" as const,
  reviewLevels: [] as (1 | 2)[],
  seriesItem: false,
};

describe("assignment edit draft hydration", () => {
  it("hydrates regular edit state with source title, normalized order, and retained defaults", () => {
    const draft = hydrateSingleAssignmentDraftFromEditResponse(baseResponse);

    expect(draft).toMatchObject({
      operation: {
        mode: "replace",
        assignmentId: assignmentContractIds.day57,
        targetStudentId: assignmentContractIds.studentA,
        sourcePurpose: "regular",
        seriesItem: false,
      },
      studentId: assignmentContractIds.studentA,
      title: { mode: "source", value: "기존 시험 제목" },
      questionCount: { mode: "manual", value: 20 },
      exam: {
        questionOrderMode: "ascending",
        timing: { mode: "total", totalSeconds: 300 },
      },
      availability: {
        mode: "at",
        koreanLocalDateTime: "2026-08-17T12:00",
      },
      deadline: {
        mode: "at",
        koreanLocalDateTime: "2026-08-18T21:00",
      },
      review: { mode: "none", scope: "dataset", levels: [1, 2] },
    });
  });

  it("derives the exact-review locked shape from the parsed server response", () => {
    const response = {
      ...baseResponse,
      purpose: "review" as const,
      questionCount: 1,
      includePendingReview: true,
      reviewLevels: [2] as (1 | 2)[],
      timingMode: "per_question" as const,
      timeLimitSeconds: 10800,
      questionTimeLimitSeconds: 20,
    };
    const draft = hydrateSingleAssignmentDraftFromEditResponse(response);

    expect(draft.operation).toStrictEqual({
      mode: "replace",
      assignmentId: assignmentContractIds.day57,
      targetStudentId: assignmentContractIds.studentA,
      sourcePurpose: "review",
      seriesItem: false,
      lockedShape: {
        datasetId: assignmentContractIds.dataset,
        orderedUnitIds: [assignmentContractIds.day60],
        questionCount: 1,
        reviewScope: "dataset",
        reviewLevels: [2],
      },
    });
    expect(draft.review).toStrictEqual({
      mode: "pending",
      scope: "dataset",
      levels: [2],
    });
    expect(draft.exam.timing).toStrictEqual({
      mode: "per_question",
      perQuestionSeconds: 20,
    });
  });

  it("rejects a review response that cannot form an exact locked draft", () => {
    expect(() =>
      hydrateSingleAssignmentDraftFromEditResponse({
        ...baseResponse,
        purpose: "review",
        questionCount: 1,
        includePendingReview: false,
      }),
    ).toThrow(InvalidAssignmentDraftError);
  });

  it("keeps the hydrated replacement target immutable", () => {
    const draft = hydrateSingleAssignmentDraftFromEditResponse(baseResponse);

    expect(
      reduceSingleAssignmentDraft(draft, {
        type: "student/changed",
        studentId: assignmentContractIds.studentB,
      }),
    ).toBe(draft);
  });
});
