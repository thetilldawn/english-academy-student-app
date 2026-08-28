import { describe, expect, it } from "vitest";

import type { DirectReviewAssignmentDraft } from "../domain/model";
import {
  prepareDirectReviewPreview,
  prepareDirectReviewSubmission,
} from "./direct-review-flow-adapter";

const draft: DirectReviewAssignmentDraft = {
  datasetId: "00000000-0000-4000-8000-000000000020",
  deadline: { mode: "none" },
  exam: {
    directionRatio: 50,
    passingScore: 80,
    questionOrderMode: "random",
    retryEnabled: false,
    retryPassingScore: 10,
    timeLimitEnabled: false,
    timing: { mode: "total", totalSeconds: 300 },
  },
  questionCount: 2,
  reviewLevels: [2, 1],
  studentId: "00000000-0000-4000-8000-000000000030",
  title: "오답 시험",
};

describe("direct review flow adapter", () => {
  it("숨긴 시간·재시험 값과 단계 순서가 달라도 같은 의미 fingerprint를 만든다", () => {
    const changedHiddenValues: DirectReviewAssignmentDraft = {
      ...draft,
      exam: {
        ...draft.exam,
        retryPassingScore: 99,
        timing: { mode: "per_question", perQuestionSeconds: 8 },
      },
      reviewLevels: [1, 2],
    };
    const first = prepareDirectReviewSubmission(
      { draft, wrongEligible: 2 },
      1000,
    );
    const second = prepareDirectReviewSubmission(
      { draft: changedHiddenValues, wrongEligible: 2 },
      1000,
    );

    expect(first.ok && first.value.fingerprint).toBe(
      second.ok && second.value.fingerprint,
    );
  });

  it("실제 시험 조건이 달라지면 다른 fingerprint를 만든다", () => {
    const baseline = prepareDirectReviewSubmission(
      { draft, wrongEligible: 2 },
      1000,
    );
    const changedPassingScore = prepareDirectReviewSubmission(
      {
        draft: {
          ...draft,
          exam: { ...draft.exam, passingScore: 70 },
        },
        wrongEligible: 2,
      },
      1000,
    );
    const changedQuestionOrder = prepareDirectReviewSubmission(
      {
        draft: {
          ...draft,
          exam: { ...draft.exam, questionOrderMode: "ascending" },
        },
        wrongEligible: 2,
      },
      1000,
    );

    expect(baseline.ok).toBe(true);
    expect(changedPassingScore.ok).toBe(true);
    expect(changedQuestionOrder.ok).toBe(true);
    if (!baseline.ok || !changedPassingScore.ok || !changedQuestionOrder.ok) {
      throw new Error("valid direct-review drafts must be accepted");
    }
    expect(changedPassingScore.value.fingerprint).not.toBe(
      baseline.value.fingerprint,
    );
    expect(changedQuestionOrder.value.fingerprint).not.toBe(
      baseline.value.fingerprint,
    );
  });

  it("제출 순간 지난 마감을 deadline 입력 오류로 돌려준다", () => {
    const expired: DirectReviewAssignmentDraft = {
      ...draft,
      deadline: { mode: "at", koreanLocalDateTime: "2026-08-28T12:00" },
    };
    const outcome = prepareDirectReviewSubmission(
      { draft: expired, wrongEligible: 2 },
      Date.parse("2026-08-28T03:00:00.000Z"),
    );

    expect(outcome).toEqual({
      error: expect.objectContaining({
        fieldPath: "deadline",
        kind: "invalid_request",
      }),
      ok: false,
    });
  });

  it("오답 Preview 409는 요약과 Preview를 함께 갱신하도록 선언한다", () => {
    const preview = prepareDirectReviewPreview({
      datasetId: draft.datasetId,
      directionRatio: draft.exam.directionRatio,
      reviewLevels: draft.reviewLevels,
      studentId: draft.studentId,
    });
    expect(preview.recoveryForResponse?.({ data: null, ok: false, status: 409 })).toBe(
      "refresh_summary_and_preview",
    );
    expect(preview.fingerprint).toContain(draft.datasetId);
  });

  it("멱등키 재사용 409는 Preview 자동 갱신 대상으로 보지 않는다", () => {
    const submission = prepareDirectReviewSubmission(
      { draft, wrongEligible: 2 },
      1000,
    );
    if (!submission.ok) throw new Error("제출 준비 실패");

    expect(
      submission.value.recoveryForResponse?.({
        data: { code: "idempotency_key_reused" },
        ok: false,
        status: 409,
      }),
    ).toBe("none");
    expect(
      submission.value.recoveryForResponse?.({
        data: { code: "review_candidates_changed" },
        ok: false,
        status: 409,
      }),
    ).toBe("refresh_summary_and_preview");
  });
});
