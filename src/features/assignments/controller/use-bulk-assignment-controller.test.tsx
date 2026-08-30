// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assignmentContractIds,
  reverseUnitIds,
} from "@/test-support/assignment-contract-fixtures";

import type { BulkCommonAssignmentPlan } from "../domain/model";
import type {
  AssignmentTransport,
  AssignmentTransportRequest,
} from "../transport/assignment-transport";
import { useBulkAssignmentController } from "./use-bulk-assignment-controller";

const NOW = Date.parse("2026-08-10T00:00:00.000Z");

function scheduledPlan(
  days: readonly number[] = [17, 19],
): BulkCommonAssignmentPlan {
  const schedule = days.map((day) => ({
    availableLocalDateTime: `2099-08-${String(day).padStart(2, "0")}T09:00`,
    deadlineLocalDateTime: `2099-08-${String(day).padStart(2, "0")}T21:00`,
  }));
  return {
    datasetId: assignmentContractIds.dataset,
    distribution: "split",
    splitBasis: "question_count",
    orderedUnitIds: [...reverseUnitIds],
    rangeUnitCounts: [],
    unitAllocationRule: null,
    questionCount: { mode: "manual", value: 12 },
    overflowPolicy: "leave",
    extraDatePolicy: "unconfirmed",
    selectedDateCount: days.length,
    selectionMode: "source_order",
    planNonce: assignmentContractIds.planNonce,
    recurrenceSessions: schedule,
    sessions: schedule.map((session) => ({
      ...session,
      unitIds: [...reverseUnitIds],
    })),
  };
}

function immediatePlan(): BulkCommonAssignmentPlan {
  return {
    datasetId: assignmentContractIds.dataset,
    distribution: "repeat",
    splitBasis: "question_count",
    orderedUnitIds: [...reverseUnitIds],
    rangeUnitCounts: [],
    unitAllocationRule: null,
    questionCount: { mode: "all" },
    overflowPolicy: "leave",
    extraDatePolicy: "unconfirmed",
    selectedDateCount: 0,
    selectionMode: "source_order",
    planNonce: assignmentContractIds.planNonce,
    recurrenceSessions: [{
      availableLocalDateTime: null,
      deadlineLocalDateTime: null,
    }],
    sessions: [{
      availableLocalDateTime: null,
      deadlineLocalDateTime: null,
      unitIds: [...reverseUnitIds],
    }],
  };
}

function previewResponse(
  studentIds: readonly string[],
  sessionCount: number,
) {
  return {
    assignableCount: studentIds.length,
    assignmentCount: studentIds.length * sessionCount,
    blockedCount: 0,
    commonPlanSummary: null,
    items: studentIds.map((studentId, studentIndex) => ({
      available: true,
      availableQuestionCount: 40,
      datasetId: assignmentContractIds.dataset,
      datasetLabel: "VOCA",
      defaultSessionCount: sessionCount,
      error: null,
      remainingQuestionCount: 0,
      requiresExtraDateDecision: false,
      scheduledQuestionCount: 40 * sessionCount,
      selectedQuestionCount: 40,
      sessions: Array.from({ length: sessionCount }, (_, index) => ({
        available: true,
        availableFrom: null,
        availableUntil: null,
        cycleIndex: 0,
        error: null,
        questionCount: 40,
        rangeTruncated: false,
        sessionNumber: index + 1,
        sourceSessionNumber: index + 1,
        unitId: assignmentContractIds.day60,
        unitIds: [assignmentContractIds.day60],
        unitLabel: `DAY ${60 - index}`,
        unitLabels: [`DAY ${60 - index}`],
      })),
      studentId,
      studentName: `학생 ${studentIndex + 1}`,
    })),
    planSignature: assignmentContractIds.previewPlanSignature,
    rangeLabel: "DAY 58-60",
  };
}

function creationResponse(
  studentIds: readonly string[],
  sessionCount: number,
) {
  return {
    assignments: studentIds.flatMap((studentId) =>
      Array.from({ length: sessionCount }, (_, index) => ({
        assignment_id: assignmentContractIds.day57,
        session_number: index + 1,
        student_id: studentId,
      })),
    ),
  };
}

function successTransport(
  requests: AssignmentTransportRequest[] = [],
): AssignmentTransport {
  return vi.fn(async (request) => {
    requests.push(request);
    const body = request.body as {
      commonPlan: { sessions: unknown[] };
      studentIds: string[];
    };
    const sessionCount = body.commonPlan.sessions.length;
    if (request.url.endsWith("/preview")) {
      return {
        data: previewResponse(body.studentIds, sessionCount),
        ok: true,
        status: 200,
      };
    }
    return {
      data: creationResponse(body.studentIds, sessionCount),
      ok: true,
      status: 201,
    };
  });
}

function renderController(
  transport: AssignmentTransport,
  initialCommonPlan?: BulkCommonAssignmentPlan,
) {
  return renderHook(() => useBulkAssignmentController({
    clock: () => NOW,
    genericErrorMessage: "일괄 배정을 저장하지 못했습니다.",
    initialCommonPlan,
    previewDelayMs: 0,
    previewErrorMessage: "학생별 범위를 계산하지 못했습니다.",
    studentIds: [assignmentContractIds.studentA],
    transport,
  }));
}

beforeEach(() => {
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => assignmentContractIds.idempotencyKey),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("일괄 배정 controller", () => {
  it("공통 계획이 없으면 미리보기를 요청하지 않는다", async () => {
    const transport = successTransport();
    const { result } = renderController(transport);

    await act(async () => Promise.resolve());

    expect(transport).not.toHaveBeenCalled();
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.submissionIssues).toEqual([
      expect.objectContaining({ path: "commonPlan" }),
    ]);
  });

  it("시험 조건만 바꾸면 미리보기를 재사용하고 변경값으로 저장한다", async () => {
    const requests: AssignmentTransportRequest[] = [];
    const transport = successTransport(requests);
    const { result } = renderController(transport, scheduledPlan());

    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    expect(requests.filter(({ url }) => url.endsWith("/preview"))).toHaveLength(1);

    act(() => {
      result.current.actions.changePassingScore(90);
      result.current.actions.changeOrder("descending");
      result.current.actions.changeTiming({
        mode: "per_question",
        perQuestionSeconds: 17,
      });
    });
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    expect(requests.filter(({ url }) => url.endsWith("/preview"))).toHaveLength(1);

    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({ ok: true });
    });
    expect(requests.at(-1)).toMatchObject({
      body: {
        passingScore: 90,
        questionOrderMode: "descending",
        questionTimeLimitSeconds: 17,
        timingMode: "per_question",
      },
      url: "/api/admin/bulk-assignments",
    });
  });

  it("공통 계획이 바뀌면 이전 미리보기를 버리고 새 계획을 요청한다", async () => {
    const requests: AssignmentTransportRequest[] = [];
    const transport = successTransport(requests);
    const { result } = renderController(transport, scheduledPlan([17]));
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    act(() => result.current.actions.changeCommonPlan(scheduledPlan([17, 19])));
    expect(result.current.preview).toBeNull();
    expect(result.current.canSubmit).toBe(false);

    await waitFor(() => expect(result.current.preview?.assignmentCount).toBe(2));
    expect(requests.filter(({ url }) => url.endsWith("/preview"))).toHaveLength(2);
  });

  it("시험일 없는 배정은 공개·마감 시각을 null로 보낸다", async () => {
    const requests: AssignmentTransportRequest[] = [];
    const transport = successTransport(requests);
    const { result } = renderController(transport, immediatePlan());

    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    expect(requests[0]?.body).toMatchObject({
      commonPlan: {
        recurrenceSessions: [{ availableFrom: null, availableUntil: null }],
        selectedDateCount: 0,
        sessions: [{ availableFrom: null, availableUntil: null }],
      },
    });

    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({ ok: true });
    });
  });

  it("같은 저장을 재시도하면 멱등 키를 재사용한다", async () => {
    const postBodies: Array<{ idempotencyKey: string }> = [];
    let submissionAttempt = 0;
    const transport: AssignmentTransport = vi.fn(async (request) => {
      const body = request.body as {
        commonPlan: { sessions: unknown[] };
        idempotencyKey?: string;
        studentIds: string[];
      };
      if (request.url.endsWith("/preview")) {
        return {
          data: previewResponse(body.studentIds, body.commonPlan.sessions.length),
          ok: true,
          status: 200,
        };
      }
      postBodies.push({ idempotencyKey: body.idempotencyKey! });
      submissionAttempt += 1;
      return submissionAttempt === 1
        ? { data: { error: "잠시 후 다시 시도해 주세요." }, ok: false, status: 503 }
        : {
            data: creationResponse(body.studentIds, body.commonPlan.sessions.length),
            ok: true,
            status: 201,
          };
    });
    const { result } = renderController(transport, scheduledPlan([17]));
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({ ok: false });
    });
    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({ ok: true });
    });

    expect(postBodies).toHaveLength(2);
    expect(postBodies[0]?.idempotencyKey).toBe(postBodies[1]?.idempotencyKey);
  });

  it("409 응답 뒤에는 같은 계획의 미리보기를 다시 확인한다", async () => {
    let previewCount = 0;
    const transport: AssignmentTransport = vi.fn(async (request) => {
      const body = request.body as {
        commonPlan: { sessions: unknown[] };
        studentIds: string[];
      };
      if (request.url.endsWith("/preview")) {
        previewCount += 1;
        return {
          data: previewResponse(body.studentIds, body.commonPlan.sessions.length),
          ok: true,
          status: 200,
        };
      }
      return {
        data: { error: "미리보기가 오래되었습니다." },
        ok: false,
        status: 409,
      };
    });
    const { result } = renderController(transport, scheduledPlan([17]));
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({
        conflict: true,
        ok: false,
      });
    });

    await waitFor(() => expect(previewCount).toBe(2));
  });
});
