// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { assignmentContractIds } from "@/test-support/assignment-contract-fixtures";

import type { AssignmentTransport } from "./assignment-transport";
import { useBulkAssignmentController } from "./use-bulk-assignment-controller";

const NOW = Date.parse("2026-08-10T00:00:00.000Z");

function previewResponse(
  studentIds: readonly string[],
  sessionCount: number,
) {
  return {
    assignableCount: studentIds.length,
    assignmentCount: studentIds.length * sessionCount,
    blockedCount: 0,
    items: studentIds.map((studentId, studentIndex) => ({
      available: true,
      datasetId: assignmentContractIds.dataset,
      datasetLabel: "능률 VOCA",
      error: null,
      sessions: Array.from({ length: sessionCount }, (_, index) => ({
        available: true,
        availableFrom: `2099-08-${String(10 + index).padStart(2, "0")}T00:00:00.000Z`,
        availableUntil: null,
        error: null,
        questionCount: 40,
        rangeTruncated: false,
        sessionNumber: index + 1,
        unitId: assignmentContractIds.day60,
        unitIds: [assignmentContractIds.day60],
        unitLabel: `DAY ${60 - index}`,
        unitLabels: [`DAY ${60 - index}`],
        wrongCount: index === 0 ? 2 : 0,
      })),
      studentId,
      studentName: `학생 ${studentIndex + 1}`,
    })),
  };
}

function creationResponse(studentIds: readonly string[], sessionCount: number) {
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

function renderController(
  transport: AssignmentTransport,
  studentIds: readonly string[] = [assignmentContractIds.studentA],
) {
  return renderHook(() =>
    useBulkAssignmentController({
      clock: () => NOW,
      firstAvailableDateKorean: "2099-08-10",
      genericErrorMessage: "일괄 배정을 저장하지 못했습니다.",
      includePendingReview: true,
      previewDelayMs: 0,
      previewErrorMessage: "학생별 범위를 계산하지 못했습니다.",
      studentIds,
      transport,
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("bulk assignment controller", () => {
  it("keeps a ready preview for exam-only changes but submits the changed settings", async () => {
    const requests: Parameters<AssignmentTransport>[0][] = [];
    const transport: AssignmentTransport = vi.fn(async (request) => {
      requests.push(request);
      const body = request.body as {
        sessionCount: number;
        studentIds: string[];
      };
      return request.url.endsWith("/preview")
        ? {
            data: previewResponse(body.studentIds, body.sessionCount),
            ok: true,
            status: 200,
          }
        : {
            data: creationResponse(body.studentIds, body.sessionCount),
            ok: true,
            status: 201,
          };
    });
    const { result } = renderController(transport);
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    expect(requests.filter((request) => request.url.endsWith("/preview"))).toHaveLength(1);

    act(() => {
      result.current.actions.changePassingScore(90);
      result.current.actions.changeOrder("descending");
      result.current.actions.changeTiming({
        mode: "per_question",
        perQuestionSeconds: 17,
      });
    });
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    expect(requests.filter((request) => request.url.endsWith("/preview"))).toHaveLength(1);

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

  it("invalidates stale preview when the 1-to-7 session schedule changes", async () => {
    const previewBodies: unknown[] = [];
    const transport: AssignmentTransport = vi.fn(async (request) => {
      const body = request.body as {
        sessionCount: number;
        studentIds: string[];
      };
      if (request.url.endsWith("/preview")) {
        previewBodies.push(body);
        return {
          data: previewResponse(body.studentIds, body.sessionCount),
          ok: true,
          status: 200,
        };
      }
      return {
        data: creationResponse(body.studentIds, body.sessionCount),
        ok: true,
        status: 201,
      };
    });
    const { result } = renderController(transport);
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    act(() => {
      result.current.actions.changeRange({
        mode: "fixed_span",
        sessionCount: 7,
        unitsPerSession: 1,
      });
      result.current.actions.changeInterval(2);
    });
    expect(result.current.preview).toBeNull();
    expect(result.current.canSubmit).toBe(false);
    await waitFor(() =>
      expect(result.current.preview?.assignmentCount).toBe(7),
    );
    expect(previewBodies.at(-1)).toMatchObject({
      dayInterval: 2,
      rangeMode: "fixed_span",
      sessionCount: 7,
    });
  });

  it("submits the supported 30-student by 7-session boundary as 210 assignments", async () => {
    const studentIds = Array.from(
      { length: 30 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const transport: AssignmentTransport = vi.fn(async (request) => {
      const body = request.body as {
        sessionCount: number;
        studentIds: string[];
      };
      return request.url.endsWith("/preview")
        ? {
            data: previewResponse(body.studentIds, body.sessionCount),
            ok: true,
            status: 200,
          }
        : {
            data: creationResponse(body.studentIds, body.sessionCount),
            ok: true,
            status: 201,
          };
    });
    const { result } = renderController(transport, studentIds);
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    act(() =>
      result.current.actions.changeRange({
        mode: "fixed_span",
        sessionCount: 7,
        unitsPerSession: 2,
      }),
    );
    await waitFor(() =>
      expect(result.current.preview?.assignmentCount).toBe(210),
    );

    await act(async () => {
      const outcome = await result.current.actions.submit();
      expect(outcome.ok && outcome.result.assignments).toHaveLength(210);
    });
  });

  it("blocks same-tick duplicate submission and refreshes preview after a 409", async () => {
    let submitCount = 0;
    let conflict = true;
    const transport: AssignmentTransport = vi.fn(async (request) => {
      const body = request.body as {
        sessionCount: number;
        studentIds: string[];
      };
      if (request.url.endsWith("/preview")) {
        return {
          data: previewResponse(body.studentIds, body.sessionCount),
          ok: true,
          status: 200,
        };
      }
      submitCount += 1;
      if (conflict) {
        conflict = false;
        return {
          data: { error: "다른 배정이 먼저 저장되었습니다." },
          ok: false,
          status: 409,
        };
      }
      return {
        data: creationResponse(body.studentIds, body.sessionCount),
        ok: true,
        status: 201,
      };
    });
    const { result } = renderController(transport);
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    let outcomes: Awaited<ReturnType<typeof result.current.actions.submit>>[] = [];
    await act(async () => {
      outcomes = await Promise.all([
        result.current.actions.submit(),
        result.current.actions.submit(),
      ]);
    });
    expect(submitCount).toBe(1);
    expect(outcomes.some((outcome) => !outcome.ok && outcome.conflict)).toBe(true);
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({ ok: true });
    });
    expect(submitCount).toBe(2);
  });
});
