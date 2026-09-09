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
      totalAvailableQuestionCount: 601,
      maximumSessionQuestionCount: 500,
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
  submissionEnabled = true,
) {
  return renderHook(() => useBulkAssignmentController({
    clock: () => NOW,
    genericErrorMessage: "일괄 배정을 저장하지 못했습니다.",
    initialCommonPlan,
    previewDelayMs: 0,
    submissionEnabled,
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
  it.each([
    { label: "요일 선택", plan: scheduledPlan([17]), submissionEnabled: true },
    { label: "요일 선택 전 수량 조회", plan: scheduledPlan([17]), submissionEnabled: false },
    { label: "시험일 미사용", plan: immediatePlan(), submissionEnabled: true },
  ])("$label: 시간·점수·재시험·문항 순서만 바꾸면 집계와 미리보기를 보존한다", async ({ plan, submissionEnabled }) => {
    const requests: AssignmentTransportRequest[] = [];
    const { result } = renderController(successTransport(requests), plan, submissionEnabled);
    await waitFor(() => expect(result.current.capacity?.status).toBe("ready"));
    const capacity = result.current.capacity;
    const preview = result.current.preview;
    const transitions = [
      () => result.current.actions.changeTiming({ mode: "total", totalSeconds: 420 }),
      () => result.current.actions.changeTiming({ mode: "per_question", perQuestionSeconds: 17 }),
      () => result.current.actions.changeTimeLimitEnabled(false),
      () => result.current.actions.changeTimeLimitEnabled(true),
      () => result.current.actions.changePassingScore(90),
      () => result.current.actions.changeRetryEnabled(false),
      () => result.current.actions.changeRetryEnabled(true),
      () => result.current.actions.changeRetryPassingScore(85),
      () => result.current.actions.changeOrder("descending"),
    ];
    for (const change of transitions) {
      act(change);
      expect(result.current.capacity).toEqual(capacity);
      expect(result.current.preview).toEqual(preview);
      expect(result.current.canSubmit).toBe(submissionEnabled);
    }
    expect(requests.filter(request => request.url.endsWith("/preview"))).toHaveLength(1);
    if (submissionEnabled) {
      await act(async () => { expect(await result.current.actions.submit()).toMatchObject({ ok: true }); });
      expect(requests.at(-1)?.body).toMatchObject({ passingScore: 90, retryPassingScore: 85,
        questionOrderMode: "descending", timingMode: "per_question", questionTimeLimitSeconds: 17 });
    }
  });

  it.each([false, true])("숫자 비움 후 복원은 같은 이벤트 여부=%s와 관계없이 새 집계를 확인한다", async (sameEvent) => {
    const requests: AssignmentTransportRequest[] = [];
    const { result } = renderController(successTransport(requests), scheduledPlan([17]));
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    act(() => {
      result.current.actions.changePassingScore(Number.NaN);
      if (sameEvent) result.current.actions.changePassingScore(80);
    });
    expect(result.current.capacity).toBeNull();
    expect(result.current.preview).toBeNull();
    expect(result.current.canSubmit).toBe(false);
    expect(requests).toHaveLength(1);
    if (!sameEvent) act(() => result.current.actions.changePassingScore(80));
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    expect(result.current.capacity?.totalAvailableQuestionCount).toBe(601);
    expect(requests.filter(request => request.url.endsWith("/preview"))).toHaveLength(2);
  });

  it("출제 방향을 바꾸면 이전 집계를 버리고 새 결과를 조회한다", async () => {
    const requests: AssignmentTransportRequest[] = [];
    const { result } = renderController(successTransport(requests), scheduledPlan([17]));
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    act(() => result.current.actions.changeDirection(100));
    expect(result.current.capacity).toBeNull();
    expect(result.current.canSubmit).toBe(false);
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    expect(requests.filter(request => request.url.endsWith("/preview"))).toHaveLength(2);
  });

  it("시간 입력을 비운 뒤 제한 없음으로 바꾸면 유효한 새 집계를 확인한다", async () => {
    const requests: AssignmentTransportRequest[] = [];
    const { result } = renderController(successTransport(requests), immediatePlan());
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    act(() => result.current.actions.changeTiming({ mode: "total", totalSeconds: Number.NaN }));
    expect(result.current.capacity).toBeNull();
    expect(result.current.canSubmit).toBe(false);
    act(() => result.current.actions.changeTimeLimitEnabled(false));
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    expect(result.current.capacity?.status).toBe("ready");
    expect(requests.filter(request => request.url.endsWith("/preview"))).toHaveLength(2);
    await act(async () => { expect(await result.current.actions.submit()).toMatchObject({ ok: true }); });
    expect(requests.at(-1)?.body).toMatchObject({ timingMode: "none" });
  });

  it("점수가 허용 범위를 벗어나면 집계는 유지해도 저장은 막는다", async () => {
    const requests: AssignmentTransportRequest[] = [];
    const { result } = renderController(successTransport(requests), immediatePlan());
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    const capacity = result.current.capacity;
    act(() => result.current.actions.changePassingScore(101));
    expect(result.current.capacity).toEqual(capacity);
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.submissionIssues.some(issue => issue.path === "exam.passingScore")).toBe(true);
    act(() => result.current.actions.changePassingScore(80));
    expect(result.current.canSubmit).toBe(true);
    expect(requests.filter(request => request.url.endsWith("/preview"))).toHaveLength(1);
  });

  it("미리보기의 입력 오류를 표시하고 같은 조건의 재시도 성공 후 해제한다", async () => {
    let calls = 0;
    const transport: AssignmentTransport = vi.fn(async () => ++calls === 1
      ? { ok: false, status: 400, data: { error: "회차당 단어 수를 먼저 입력해 주세요.",
          code: "invalid_assignment_condition", fieldPath: "commonPlan.overflowPolicy" } }
      : { ok: true, status: 200, data: previewResponse([assignmentContractIds.studentA], 1) });
    const { result } = renderController(transport, scheduledPlan([17]));
    await waitFor(() => expect(result.current.state.preview.status).toBe("error"));
    expect(result.current.submissionIssues).toContainEqual({ code: "invalid_order",
      path: "commonPlan.overflowPolicy", message: "회차당 단어 수를 먼저 입력해 주세요." });
    expect(result.current.canSubmit).toBe(false);
    const draft = result.current.state.draft;
    act(() => result.current.actions.refreshPreview());
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    expect(result.current.submissionIssues).toEqual([]);
    expect(result.current.state.draft).toEqual(draft);
  });

  it("날짜만 변경 중에는 집계만 유지하고 이전 미리보기로 저장하지 않는다", async () => {
    const transport = successTransport();
    const { result } = renderController(transport, scheduledPlan([17]));
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    expect(result.current.capacity?.totalAvailableQuestionCount).toBe(601);
    act(() => result.current.actions.changeCommonPlan(scheduledPlan([17, 19])));
    expect(result.current.capacity?.defaultSessionCount).toBe(1);
    expect(result.current.preview).toBeNull();
    expect(result.current.canSubmit).toBe(false);
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    act(() => result.current.actions.changeDirection(0));
    expect(result.current.capacity).toBeNull();
    expect(result.current.canSubmit).toBe(false);
  });
  it("명시적인 새로고침과 저장 성공은 용량 보관을 폐기한다", async () => {
    const { result } = renderController(successTransport(), scheduledPlan([17]));
    await waitFor(() => expect(result.current.capacity).not.toBeNull());
    act(() => result.current.actions.refreshPreview());
    expect(result.current.capacity).toBeNull();
    await waitFor(() => expect(result.current.capacity).not.toBeNull());
    await act(async () => { await result.current.actions.submit(); });
    expect(result.current.capacity).toBeNull();
  });
  it.each([401, 403, 503])("날짜 재조회 %i 실패는 이전 숫자로 덮지 않는다", async status => {
    let calls = 0;
    const transport: AssignmentTransport = vi.fn(async () => ++calls === 1
      ? { ok: true, status: 200, data: previewResponse([assignmentContractIds.studentA], 1) }
      : { ok: false, status, data: { error: "다시 확인해 주세요." } });
    const { result } = renderController(transport, scheduledPlan([17]));
    await waitFor(() => expect(result.current.capacity).not.toBeNull());
    act(() => result.current.actions.changeCommonPlan(scheduledPlan([19])));
    await waitFor(() => expect(result.current.state.preview.status).toBe("error"));
    expect(result.current.capacity).toBeNull();
    expect(result.current.canSubmit).toBe(false);
  });
  it("늦게 도착한 이전 범위 응답은 용량을 복원하지 않는다", async () => {
    let resolveOld!: (value: Awaited<ReturnType<AssignmentTransport>>) => void;
    const transport: AssignmentTransport = vi.fn(() => new Promise<Awaited<ReturnType<AssignmentTransport>>>(resolve => { resolveOld = resolve; }));
    const { result } = renderController(transport, scheduledPlan([17]));
    await waitFor(() => expect(transport).toHaveBeenCalledOnce());
    act(() => result.current.actions.changeCommonPlan(undefined));
    await act(async () => resolveOld({ ok: true, status: 200, data: previewResponse([assignmentContractIds.studentA], 1) }));
    expect(result.current.capacity).toBeNull();
    expect(result.current.preview).toBeNull();
  });
  it("날짜 선택0인 성공 응답에서도 가능한 회차를 보존한다", async () => {
    const data = previewResponse([assignmentContractIds.studentA], 0);
    data.items[0]!.defaultSessionCount = 7;
    data.items[0]!.available = false;
    data.assignableCount = 0;
    data.blockedCount = 1;
    const transport: AssignmentTransport = vi.fn(async () => ({ ok: true, status: 200, data }));
    const { result } = renderController(transport, scheduledPlan([17]), false);
    await waitFor(() => expect(result.current.capacity?.defaultSessionCount).toBe(7));
    expect(result.current.canSubmit).toBe(false);
    await act(async () => expect(await result.current.actions.submit()).toMatchObject({ ok: false }));
    expect(transport).toHaveBeenCalledOnce();
  });
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

  it("같은 배정 계획을 다시 받아도 상태와 미리보기를 갱신하지 않는다", async () => {
    const requests: AssignmentTransportRequest[] = [];
    const transport = successTransport(requests);
    const { result } = renderController(transport, scheduledPlan([17]));
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    const revision = result.current.state.revision;
    act(() => result.current.actions.changeCommonPlan(scheduledPlan([17])));

    expect(result.current.state.revision).toBe(revision);
    expect(requests.filter(({ url }) => url.endsWith("/preview"))).toHaveLength(1);
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
