import { describe, expect, it, vi } from "vitest";

import {
  assignmentContractIds,
} from "@/test-support/assignment-contract-fixtures";

import { resolveSingleAssignmentDraft } from "../domain/single-draft";
import type { AssignmentTransport } from "../transport/assignment-transport";
import {
  loadSingleAssignmentEditDraft,
  prepareSingleAssignmentPreview,
  prepareSingleAssignmentSubmission,
} from "./assignment-edit-flow-adapter";

const editResponse = {
  assignmentId: "88888888-8888-4888-8888-888888888888",
  availableFrom: "2026-08-17T00:00:00.000Z",
  availableUntil: "2026-08-18T12:00:00.000Z",
  datasetId: assignmentContractIds.dataset,
  englishToKoreanRatio: 50 as const,
  includePendingReview: true,
  passingScore: 80,
  primaryUnitIds: [assignmentContractIds.day60],
  purpose: "mixed" as const,
  questionCount: 10,
  questionOrderMode: "random" as const,
  questionTimeLimitSeconds: null,
  retryEnabled: true,
  retryPassingScore: 80,
  reviewLevels: [2] as (1 | 2)[],
  reviewScope: "dataset" as const,
  seriesItem: false,
  studentId: assignmentContractIds.studentA,
  studentName: "검증 학생",
  timeLimitSeconds: 300,
  timingMode: "total" as const,
  title: "기존 혼합 시험",
};

describe("assignment edit application adapter", () => {
  it("수정 원본 GET을 검증하고 같은 편집 draft로 복원한다", async () => {
    const transport: AssignmentTransport = vi.fn().mockResolvedValue({
      data: editResponse,
      ok: true,
      status: 200,
    });

    const result = await loadSingleAssignmentEditDraft({
      assignmentId: editResponse.assignmentId,
      fallback: "수정안을 불러오지 못했습니다.",
      studentId: editResponse.studentId,
      transport,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        operation: {
          assignmentId: editResponse.assignmentId,
          mode: "replace",
          sourcePurpose: "mixed",
          targetStudentId: editResponse.studentId,
        },
        review: { levels: [2], mode: "pending", scope: "dataset" },
      },
    });
    expect(transport).toHaveBeenCalledWith({
      method: "GET",
      signal: undefined,
      url: `/api/admin/assignments/${editResponse.assignmentId}/students/${editResponse.studentId}`,
    });
  });

  it("수정 대상 ID가 다른 성공 응답을 protocol 오류로 거부한다", async () => {
    const result = await loadSingleAssignmentEditDraft({
      assignmentId: editResponse.assignmentId,
      fallback: "수정안을 불러오지 못했습니다.",
      studentId: editResponse.studentId,
      transport: vi.fn().mockResolvedValue({
        data: { ...editResponse, studentId: assignmentContractIds.studentB },
        ok: true,
        status: 200,
      }),
    });

    expect(result).toMatchObject({ error: { kind: "protocol" }, ok: false });
  });

  it("Preview와 PUT 준비가 같은 수정 draft 계약을 사용한다", async () => {
    const loaded = await loadSingleAssignmentEditDraft({
      assignmentId: editResponse.assignmentId,
      fallback: "수정안을 불러오지 못했습니다.",
      studentId: editResponse.studentId,
      transport: vi.fn().mockResolvedValue({
        data: editResponse,
        ok: true,
        status: 200,
      }),
    });
    if (!loaded.ok) throw new Error("수정 draft 복원 실패");
    const draft = loaded.value;
    const resolved = resolveSingleAssignmentDraft(draft, {
      title: editResponse.title,
    });
    const preview = prepareSingleAssignmentPreview(
      {
        directionRatio: draft.exam.directionRatio,
        operation: draft.operation,
        range: draft.range,
        review: draft.review,
        studentId: draft.studentId,
      },
      "계산 실패",
    );
    const submission = prepareSingleAssignmentSubmission(
      { draft, fallback: "수정 실패", resolved },
      Date.parse("2026-08-16T00:00:00.000Z"),
    );

    expect(preview?.preparation.request).toMatchObject({ method: "POST" });
    expect(preview?.minimumAllowedQuestionCount).toBe(4);
    expect(
      preview?.preparation.recoveryForResponse?.({
        data: { code: "assignment_source_changed" },
        ok: false,
        status: 409,
      }),
    ).toBe("reload_source");
    expect(
      prepareSingleAssignmentPreview(
        {
          directionRatio: draft.exam.directionRatio,
          operation: { mode: "create" },
          range: draft.range,
          review: draft.review,
          studentId: draft.studentId,
        },
        "계산 실패",
      )?.preparation.recoveryForResponse?.({
        data: { code: "assignment_source_changed" },
        ok: false,
        status: 409,
      }),
    ).toBe("refresh_preview");
    expect(submission.ok).toBe(true);
    if (!submission.ok) return;
    expect(
      submission.value.request(assignmentContractIds.idempotencyKey),
    ).toMatchObject({ method: "PUT" });
    expect(
      submission.value.recoveryForResponse?.({
        data: { code: "assignment_source_changed" },
        ok: false,
        status: 409,
      }),
    ).toBe("reload_source");
    expect(
      submission.value.recoveryForResponse?.({
        data: { code: "idempotency_key_reused" },
        ok: false,
        status: 409,
      }),
    ).toBe("none");
  });

  it("제출 순간 지난 마감을 deadline 입력 오류로 돌려준다", async () => {
    const loaded = await loadSingleAssignmentEditDraft({
      assignmentId: editResponse.assignmentId,
      fallback: "수정안을 불러오지 못했습니다.",
      studentId: editResponse.studentId,
      transport: vi.fn().mockResolvedValue({
        data: editResponse,
        ok: true,
        status: 200,
      }),
    });
    if (!loaded.ok) throw new Error("수정 draft 복원 실패");
    const resolved = resolveSingleAssignmentDraft(loaded.value, {
      title: editResponse.title,
    });

    expect(
      prepareSingleAssignmentSubmission(
        { draft: loaded.value, fallback: "수정 실패", resolved },
        Date.parse("2026-08-19T00:00:00.000Z"),
      ),
    ).toMatchObject({
      error: { fieldPath: "deadline", kind: "invalid_request" },
      ok: false,
    });
  });
});
