import { describe, expect, it } from "vitest";

import {
  assignmentContractIds,
} from "@/test-support/assignment-contract-fixtures";

import {
  createInitialBulkSeriesAssignmentDraft,
} from "../domain/bulk-draft";
import type { BulkSeriesAssignmentDraft } from "../domain/model";
import {
  bulkPreviewIdentity,
  prepareBulkAssignmentPreview,
  prepareBulkAssignmentSubmission,
} from "./bulk-assignment-flow-adapter";

const BEFORE_DEADLINE = Date.parse("2026-08-10T00:00:00.000Z");
const AFTER_DEADLINE = Date.parse("2026-08-10T02:00:00.000Z");

function draftFor(studentIds: readonly string[]): BulkSeriesAssignmentDraft {
  return {
    ...createInitialBulkSeriesAssignmentDraft({
      firstAvailableDateKorean: "2026-08-10",
      includePendingReview: false,
      studentIds,
    }),
    firstDeadline: {
      mode: "at",
      koreanLocalDateTime: "2026-08-10T10:00",
    },
  };
}

function previewFor(studentIds: readonly string[]) {
  return {
    assignableCount: studentIds.length,
    assignmentCount: studentIds.length,
    blockedCount: 0,
    commonPlanSummary: null,
    items: studentIds.map((studentId, index) => ({
      available: true,
      availableQuestionCount: 40,
      datasetId: assignmentContractIds.dataset,
      datasetLabel: "능률 VOCA",
      defaultSessionCount: 1,
      error: null,
      remainingQuestionCount: 0,
      requiresExtraDateDecision: false,
      scheduledQuestionCount: 40,
      selectedQuestionCount: 40,
      sessions: [{
        available: true,
        availableFrom: "2026-08-09T15:00:00.000Z",
        availableUntil: "2026-08-10T01:00:00.000Z",
        cycleIndex: 0,
        error: null,
        questionCount: 40,
        rangeTruncated: false,
        sessionNumber: 1,
        sourceSessionNumber: 1,
        unitId: assignmentContractIds.day60,
        unitIds: [assignmentContractIds.day60],
        unitLabel: "DAY 60",
        unitLabels: ["DAY 60"],
        warnings: [],
        wrongCount: 0,
      }],
      studentId,
      studentName: `학생 ${index + 1}`,
    })),
    planSignature: assignmentContractIds.previewPlanSignature,
    rangeLabel: "DAY 60",
  };
}

describe("bulk assignment application adapter", () => {
  it.each([
    [[assignmentContractIds.studentA]],
    [[assignmentContractIds.studentA, assignmentContractIds.studentB]],
  ])("학생 수와 무관하게 같은 Preview·저장 경계를 사용한다", (studentIds) => {
    const draft = draftFor(studentIds);
    const preview = previewFor(studentIds);
    const previewPreparation = prepareBulkAssignmentPreview(draft);
    const previewFingerprint = bulkPreviewIdentity(draft);

    expect(previewPreparation?.request.url).toBe(
      "/api/admin/bulk-assignments/preview",
    );
    expect(previewFingerprint).toBe(previewPreparation?.fingerprint);
    const submission = prepareBulkAssignmentSubmission(
      {
        draft,
        preview,
        previewFingerprint: previewFingerprint!,
      },
      BEFORE_DEADLINE,
    );
    expect(submission.ok).toBe(true);
    if (!submission.ok) return;
    const request = submission.value.request(
      assignmentContractIds.idempotencyKey,
    );
    expect(request.url).toBe("/api/admin/bulk-assignments");
    expect(request.body).toMatchObject({
      idempotencyKey: assignmentContractIds.idempotencyKey,
      studentIds,
    });
  });

  it("창을 연 뒤 마감이 지나면 제출 준비 단계에서 다시 거부한다", () => {
    const draft = draftFor([assignmentContractIds.studentA]);
    const preview = previewFor(draft.studentIds);
    const previewFingerprint = bulkPreviewIdentity(draft)!;

    expect(
      prepareBulkAssignmentSubmission(
        { draft, preview, previewFingerprint },
        BEFORE_DEADLINE,
      ),
    ).toMatchObject({ ok: true });
    expect(
      prepareBulkAssignmentSubmission(
        { draft, preview, previewFingerprint },
        AFTER_DEADLINE,
      ),
    ).toEqual({
      error: expect.objectContaining({
        fieldPath: "firstDeadline",
        kind: "invalid_request",
      }),
      ok: false,
    });
  });

  it("현재 draft와 다른 Preview fingerprint를 저장하지 않는다", () => {
    const draft = draftFor([assignmentContractIds.studentA]);

    expect(
      prepareBulkAssignmentSubmission(
        {
          draft,
          preview: previewFor(draft.studentIds),
          previewFingerprint: "stale-preview",
        },
        BEFORE_DEADLINE,
      ),
    ).toEqual({
      error: expect.objectContaining({
        fieldPath: "preview",
        recovery: "refresh_preview",
      }),
      ok: false,
    });
  });

  it("저장 응답 수가 Preview와 다르면 성공 응답으로 해석하지 않는다", () => {
    const draft = draftFor([assignmentContractIds.studentA]);
    const preview = previewFor(draft.studentIds);
    const prepared = prepareBulkAssignmentSubmission(
      {
        draft,
        preview,
        previewFingerprint: bulkPreviewIdentity(draft)!,
      },
      BEFORE_DEADLINE,
    );
    if (!prepared.ok) throw new Error("제출 준비 실패");

    expect(() => prepared.value.parse({ assignments: [] })).toThrow(
      "배정 결과 수가 미리보기와 다릅니다.",
    );
    expect(
      prepared.value.recoveryForResponse?.({ data: null, ok: false, status: 409 }),
    ).toBe("refresh_preview");
  });
});
