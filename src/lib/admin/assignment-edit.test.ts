import { describe, expect, it } from "vitest";

import {
  assignmentEditChangeKeys,
  isStudentAssignmentEditable,
  preservedAssignmentReplacementPlan,
  type AssignmentEditDraft,
  type AssignmentReplacementInput,
} from "@/lib/admin/assignment-edit";
import {
  isoToKoreanDateTimeLocal,
  koreanDateTimeLocalToIso,
} from "@/lib/deadline";

const before: AssignmentEditDraft = {
  assignmentId: "11111111-1111-4111-8111-111111111111",
  studentId: "22222222-2222-4222-8222-222222222222",
  studentName: "테스트 학생",
  purpose: "mixed",
  title: "기존 시험",
  datasetId: "33333333-3333-4333-8333-333333333333",
  primaryUnitIds: ["44444444-4444-4444-8444-444444444444"],
  questionCount: 20,
  englishToKoreanRatio: 50,
  timeLimitSeconds: 300,
  timingMode: "total",
  questionTimeLimitSeconds: null,
  passingScore: 80,
  questionOrderMode: "random",
  availableUntil: "2026-08-08T12:30:00.000Z",
  includePendingReview: true,
  reviewLevels: [1, 2],
};

function editableValues(
  draft: AssignmentEditDraft,
): Omit<AssignmentReplacementInput, "idempotencyKey"> {
  return {
    title: draft.title,
    datasetId: draft.datasetId,
    primaryUnitIds: draft.primaryUnitIds,
    questionCount: draft.questionCount,
    englishToKoreanRatio: draft.englishToKoreanRatio,
    timeLimitSeconds: draft.timeLimitSeconds,
    timingMode: draft.timingMode,
    questionTimeLimitSeconds: draft.questionTimeLimitSeconds,
    passingScore: draft.passingScore,
    questionOrderMode: draft.questionOrderMode,
    availableUntil: draft.availableUntil,
    includePendingReview: draft.includePendingReview,
    reviewLevels: draft.reviewLevels,
  };
}

describe("assignment edit helpers", () => {
  it("활성 오답이 사라진 mixed snapshot은 regular 교체로 내린다", () => {
    expect(preservedAssignmentReplacementPlan("mixed", false)).toEqual({
      kind: "regular",
      reviewSnapshotMode: "none",
    });
    expect(preservedAssignmentReplacementPlan("mixed", true)).toEqual({
      kind: "mixed",
      reviewSnapshotMode: "preserve",
    });
    expect(preservedAssignmentReplacementPlan("review", true)).toEqual({
      kind: "review",
      reviewSnapshotMode: "preserve",
    });
  });

  it("같은 초기값은 변경으로 취급하지 않는다", () => {
    const same = editableValues(before);
    expect(assignmentEditChangeKeys(before, same)).toEqual([]);
  });

  it("범위·문항·시간·오답 조건의 변경을 분리한다", () => {
    const same = editableValues(before);
    expect(
      assignmentEditChangeKeys(before, {
        ...same,
        primaryUnitIds: [
          "55555555-5555-4555-8555-555555555555",
        ],
        questionCount: 15,
        timingMode: "per_question",
        timeLimitSeconds: 10800,
        questionTimeLimitSeconds: 10,
        reviewLevels: [2],
      }),
    ).toEqual(["range", "questionCount", "timing", "review"]);
  });

  it("틀렸던 단어 추가가 꺼져 있으면 숨은 단계값 차이는 무시한다", () => {
    const regular = {
      ...before,
      includePendingReview: false,
      reviewLevels: [1] as (1 | 2)[],
    };
    expect(
      assignmentEditChangeKeys(regular, {
        ...editableValues(regular),
        reviewLevels: [2],
      }),
    ).toEqual([]);
  });

  it("한국시간 datetime-local 값을 UTC ISO와 왕복한다", () => {
    const local = "2026-08-08T21:30";
    const iso = koreanDateTimeLocalToIso(local);
    expect(iso).toBe("2026-08-08T12:30:00.000Z");
    expect(isoToKoreanDateTimeLocal(iso)).toBe(local);
  });

  it("응시 전·비삭제 학생별 배정에만 수정 버튼을 허용한다", () => {
    expect(
      isStudentAssignmentEditable({
        status: "not_started",
        attemptId: null,
        assignmentDeleted: false,
        assignmentStatus: "active",
        availableUntil: "2099-08-08T12:30:00.000Z",
        studentDeleted: false,
        studentStatus: "active",
      }),
    ).toBe(true);
    expect(
      isStudentAssignmentEditable({
        status: "in_progress",
        attemptId: "attempt",
        assignmentDeleted: false,
        assignmentStatus: "active",
        availableUntil: null,
        studentDeleted: false,
        studentStatus: "active",
      }),
    ).toBe(false);
    expect(
      isStudentAssignmentEditable({
        status: "not_started",
        attemptId: null,
        assignmentDeleted: false,
        assignmentStatus: "active",
        availableUntil: "2020-08-08T12:30:00.000Z",
        studentDeleted: false,
        studentStatus: "active",
      }),
    ).toBe(false);
    for (const blocked of [
      { assignmentStatus: "closed" as const },
      { studentStatus: "blocked" as const },
      { assignmentDeleted: true },
      { studentDeleted: true },
    ]) {
      expect(
        isStudentAssignmentEditable({
          status: "not_started",
          attemptId: null,
          assignmentDeleted: false,
          assignmentStatus: "active",
          availableUntil: null,
          studentDeleted: false,
          studentStatus: "active",
          ...blocked,
        }),
      ).toBe(false);
    }
  });
});
