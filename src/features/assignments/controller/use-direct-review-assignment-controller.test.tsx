// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AssignmentDatasetItem,
  AssignmentStudentItem,
} from "../catalog-types";
import type { AssignmentTransport } from "../transport/assignment-transport";
import { useDirectReviewAssignmentController } from "./use-direct-review-assignment-controller";

const ids = {
  assignment: "00000000-0000-4000-8000-000000000010",
  dataset: "00000000-0000-4000-8000-000000000020",
  student: "00000000-0000-4000-8000-000000000030",
  idempotency: "00000000-0000-4000-8000-000000000050",
} as const;

const dataset: AssignmentDatasetItem = {
  academicYear: null,
  catalogGroup: "middle",
  catalogSortIndex: 1,
  curriculumRevision: null,
  displayName: "테스트 단어장",
  edition: null,
  editionLabel: null,
  gradeCode: null,
  id: ids.dataset,
  isActive: true,
  isAssignable: true,
  materialKind: "wordbook",
  publisher: null,
  rowCount: 100,
  seriesTitle: null,
  status: "ready",
  title: "테스트 단어장",
};

const student: AssignmentStudentItem = {
  currentVocabBook: "테스트 단어장",
  currentVocabDatasetId: ids.dataset,
  displayName: "가짜 학생",
  gradeLabel: "중1",
  id: ids.student,
  schoolName: "가짜중",
  status: "active",
};

const summaryResponse = {
  summaries: [{
    datasetId: ids.dataset,
    latestWrongAt: "2026-08-24T01:00:00.000Z",
    level1Count: 1,
    level2Count: 1,
    totalCount: 2,
  }],
};

const capacityResponse = {
  wrongEligible: 2,
  wrongLevel1Eligible: 1,
  wrongLevel2Eligible: 1,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("direct review assignment controller", () => {
  it("오답 탭을 열 때만 요약을 한 번 읽고 현재 오답으로 계산한다", async () => {
    const requests: Parameters<AssignmentTransport>[0][] = [];
    const transport: AssignmentTransport = vi.fn(async (request) => {
      requests.push(request);
      if (request.url.endsWith("/direct-review-summaries")) {
        return { data: summaryResponse, ok: true, status: 200 };
      }
      return { data: capacityResponse, ok: true, status: 200 };
    });
    const { result, rerender } = renderHook(
      ({ enabled }) => useDirectReviewAssignmentController({
        datasets: [dataset],
        enabled,
        initialDatasetId: ids.dataset,
        student,
        transport,
      }),
      { initialProps: { enabled: false } },
    );

    await act(async () => Promise.resolve());
    expect(transport).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    expect(
      requests.filter((request) =>
        request.url.endsWith("/direct-review-summaries")
      ),
    ).toHaveLength(1);
    expect(requests.find((request) =>
      request.url === "/api/admin/exact-review-assignments/preview"
    )).toMatchObject({
      body: {
        reviewLevels: [1, 2],
        studentId: ids.student,
        datasetId: ids.dataset,
      },
      method: "POST",
    });
    expect(result.current.draft.questionCount).toBe(2);

    rerender({ enabled: true });
    await act(async () => Promise.resolve());
    expect(
      requests.filter((request) =>
        request.url.endsWith("/direct-review-summaries")
      ),
    ).toHaveLength(1);
  });

  it("저장 재시도에는 같은 멱등키를 사용한다", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      ids.idempotency,
    );
    const exactBodies: Record<string, unknown>[] = [];
    const transport: AssignmentTransport = vi.fn(async (request) => {
      if (request.url.endsWith("/direct-review-summaries")) {
        return { data: summaryResponse, ok: true, status: 200 };
      }
      if (request.url === "/api/admin/exact-review-assignments/preview") {
        return { data: capacityResponse, ok: true, status: 200 };
      }
      exactBodies.push(request.body as Record<string, unknown>);
      return exactBodies.length === 1
        ? { data: { error: "일시 오류" }, ok: false, status: 503 }
        : {
            data: { assignmentId: ids.assignment },
            ok: true,
            status: 201,
          };
    });
    const { result } = renderHook(() =>
      useDirectReviewAssignmentController({
        datasets: [dataset],
        enabled: true,
        initialDatasetId: ids.dataset,
        student,
        transport,
      }),
    );
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({
        ok: false,
      });
    });
    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({
        ok: true,
      });
    });

    expect(exactBodies).toHaveLength(2);
    expect(exactBodies[0]?.idempotencyKey).toBe(ids.idempotency);
    expect(exactBodies[1]?.idempotencyKey).toBe(ids.idempotency);
  });

  it("400개 제한으로 이번 후보에 없는 단계도 전체 요약에 남으면 유지한다", async () => {
    const transport: AssignmentTransport = vi.fn(async (request) => {
      if (request.url.endsWith("/direct-review-summaries")) {
        return {
          data: {
            summaries: [{
              ...summaryResponse.summaries[0],
              level1Count: 5,
              level2Count: 400,
              totalCount: 405,
            }],
          },
          ok: true,
          status: 200,
        };
      }
      return {
        data: {
          ...capacityResponse,
          wrongEligible: 400,
          wrongLevel1Eligible: 0,
          wrongLevel2Eligible: 400,
        },
        ok: true,
        status: 200,
      };
    });
    const { result } = renderHook(() =>
      useDirectReviewAssignmentController({
        datasets: [dataset],
        enabled: true,
        initialDatasetId: ids.dataset,
        student,
        transport,
      }),
    );

    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    expect(result.current.knownLevelCounts).toEqual({
      level1: 5,
      level2: 400,
    });
    expect(result.current.draft.reviewLevels).toEqual([1, 2]);
    expect(result.current.draft.questionCount).toBe(400);
  });

  it("창을 연 뒤 마감이 지나면 실제 제출 시각에 요청 없이 막는다", async () => {
    let now = Date.parse("2026-08-28T02:59:00.000Z");
    const requests: Parameters<AssignmentTransport>[0][] = [];
    const transport: AssignmentTransport = vi.fn(async (request) => {
      requests.push(request);
      if (request.url.endsWith("/direct-review-summaries")) {
        return { data: summaryResponse, ok: true, status: 200 };
      }
      return { data: capacityResponse, ok: true, status: 200 };
    });
    const { result } = renderHook(() =>
      useDirectReviewAssignmentController({
        clock: () => now,
        datasets: [dataset],
        enabled: true,
        initialDatasetId: ids.dataset,
        previewDelayMs: 0,
        student,
        transport,
      }),
    );
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    act(() => {
      result.current.actions.changeDeadline({
        mode: "at",
        koreanLocalDateTime: "2026-08-28T12:00",
      });
    });
    expect(result.current.canSubmit).toBe(true);

    now = Date.parse("2026-08-28T03:00:00.000Z");
    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({
        ok: false,
      });
    });

    expect(
      requests.filter((request) =>
        request.url === "/api/admin/exact-review-assignments"
      ),
    ).toHaveLength(0);
    expect(result.current.fieldErrors.deadline).toBeTruthy();
  });

  it("저장 409 뒤 오답 요약과 Preview를 모두 다시 계산한다", async () => {
    let summaryCalls = 0;
    let previewCalls = 0;
    let submitCalls = 0;
    const transport: AssignmentTransport = vi.fn(async (request) => {
      if (request.url.endsWith("/direct-review-summaries")) {
        summaryCalls += 1;
        return { data: summaryResponse, ok: true, status: 200 };
      }
      if (request.url === "/api/admin/exact-review-assignments/preview") {
        previewCalls += 1;
        return { data: capacityResponse, ok: true, status: 200 };
      }
      submitCalls += 1;
      return {
        data: { error: "오답 목록이 바뀌었습니다." },
        ok: false,
        status: 409,
      };
    });
    const { result } = renderHook(() =>
      useDirectReviewAssignmentController({
        datasets: [dataset],
        enabled: true,
        initialDatasetId: ids.dataset,
        previewDelayMs: 0,
        student,
        transport,
      }),
    );
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({
        conflict: true,
        ok: false,
      });
    });
    await waitFor(() => {
      expect(summaryCalls).toBe(2);
      expect(previewCalls).toBe(2);
      expect(result.current.capacity.status).toBe("ready");
    });
    expect(submitCalls).toBe(1);
  });

  it("Preview 409는 요약과 Preview를 한 번만 다시 계산한다", async () => {
    let summaryCalls = 0;
    let previewCalls = 0;
    const transport: AssignmentTransport = vi.fn(async (request) => {
      if (request.url.endsWith("/direct-review-summaries")) {
        summaryCalls += 1;
        return { data: summaryResponse, ok: true, status: 200 };
      }
      previewCalls += 1;
      return {
        data: { error: "오답 목록이 바뀌었습니다." },
        ok: false,
        status: 409,
      };
    });
    const { result } = renderHook(() =>
      useDirectReviewAssignmentController({
        datasets: [dataset],
        enabled: true,
        initialDatasetId: ids.dataset,
        previewDelayMs: 0,
        student,
        transport,
      }),
    );

    await waitFor(() => {
      expect(summaryCalls).toBe(2);
      expect(previewCalls).toBe(2);
      expect(result.current.capacity.status).toBe("error");
    });
    expect(result.current.message).toBe("오답 목록이 바뀌었습니다.");
  });

  it("취소 신호를 무시한 이전 Preview 응답도 반영하지 않는다", async () => {
    let releaseFirstPreview!: (
      value: { data: unknown; ok: boolean; status: number },
    ) => void;
    let previewCalls = 0;
    const transport: AssignmentTransport = vi.fn(async (request) => {
      if (request.url.endsWith("/direct-review-summaries")) {
        return { data: summaryResponse, ok: true, status: 200 };
      }
      previewCalls += 1;
      if (previewCalls === 1) {
        return await new Promise<{
          data: unknown;
          ok: boolean;
          status: number;
        }>((resolve) => {
          releaseFirstPreview = resolve;
        });
      }
      return {
        data: {
          wrongEligible: 1,
          wrongLevel1Eligible: 1,
          wrongLevel2Eligible: 0,
        },
        ok: true,
        status: 200,
      };
    });
    const { result } = renderHook(() =>
      useDirectReviewAssignmentController({
        datasets: [dataset],
        enabled: true,
        initialDatasetId: ids.dataset,
        previewDelayMs: 0,
        student,
        transport,
      }),
    );
    await waitFor(() => expect(previewCalls).toBe(1));

    act(() => result.current.actions.changeDirection(100));
    await waitFor(() => expect(result.current.draft.questionCount).toBe(1));
    await act(async () => {
      releaseFirstPreview({ data: capacityResponse, ok: true, status: 200 });
      await Promise.resolve();
    });

    expect(result.current.draft.questionCount).toBe(1);
    expect(previewCalls).toBe(2);
  });

  it("같은 순간 두 번 저장해도 생성 요청은 한 번만 보낸다", async () => {
    let releaseSubmit!: (
      value: { data: unknown; ok: boolean; status: number },
    ) => void;
    let submitCalls = 0;
    const transport: AssignmentTransport = vi.fn(async (request) => {
      if (request.url.endsWith("/direct-review-summaries")) {
        return { data: summaryResponse, ok: true, status: 200 };
      }
      if (request.url === "/api/admin/exact-review-assignments/preview") {
        return { data: capacityResponse, ok: true, status: 200 };
      }
      submitCalls += 1;
      return await new Promise<{
        data: unknown;
        ok: boolean;
        status: number;
      }>((resolve) => {
        releaseSubmit = resolve;
      });
    });
    const { result } = renderHook(() =>
      useDirectReviewAssignmentController({
        datasets: [dataset],
        enabled: true,
        initialDatasetId: ids.dataset,
        previewDelayMs: 0,
        student,
        transport,
      }),
    );
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    let first!: ReturnType<typeof result.current.actions.submit>;
    let second!: ReturnType<typeof result.current.actions.submit>;
    act(() => {
      first = result.current.actions.submit();
      second = result.current.actions.submit();
      result.current.actions.changePassingScore(70);
    });
    await expect(second).resolves.toMatchObject({ ok: false });
    expect(submitCalls).toBe(1);
    expect(result.current.draft.exam.passingScore).toBe(80);
    await act(async () => {
      releaseSubmit({
        data: { assignmentId: ids.assignment },
        ok: true,
        status: 201,
      });
      await expect(first).resolves.toMatchObject({ ok: true });
    });
    expect(submitCalls).toBe(1);
  });

  it("제출 중 clock과 transport가 바뀌어도 재시도 멱등키를 유지한다", async () => {
    let releaseFirst!: (
      value: { data: unknown; ok: boolean; status: number },
    ) => void;
    const idempotencyKeys: string[] = [];
    const firstTransport: AssignmentTransport = vi.fn(async (request) => {
      if (request.url.endsWith("/direct-review-summaries")) {
        return { data: summaryResponse, ok: true, status: 200 };
      }
      if (request.url === "/api/admin/exact-review-assignments/preview") {
        return { data: capacityResponse, ok: true, status: 200 };
      }
      idempotencyKeys.push(
        (request.body as { idempotencyKey: string }).idempotencyKey,
      );
      return await new Promise<{
        data: unknown;
        ok: boolean;
        status: number;
      }>((resolve) => {
        releaseFirst = resolve;
      });
    });
    const secondTransport: AssignmentTransport = vi.fn(async (request) => {
      if (request.url.endsWith("/direct-review-summaries")) {
        return { data: summaryResponse, ok: true, status: 200 };
      }
      if (request.url === "/api/admin/exact-review-assignments/preview") {
        return { data: capacityResponse, ok: true, status: 200 };
      }
      idempotencyKeys.push(
        (request.body as { idempotencyKey: string }).idempotencyKey,
      );
      return {
        data: { assignmentId: ids.assignment },
        ok: true,
        status: 201,
      };
    });
    const { result, rerender } = renderHook(
      ({ clock, transport }) => useDirectReviewAssignmentController({
        clock,
        datasets: [dataset],
        enabled: true,
        initialDatasetId: ids.dataset,
        previewDelayMs: 0,
        student,
        transport,
      }),
      {
        initialProps: {
          clock: () => 1000,
          transport: firstTransport,
        },
      },
    );
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    let first!: ReturnType<typeof result.current.actions.submit>;
    act(() => {
      first = result.current.actions.submit();
    });
    rerender({ clock: () => 2000, transport: secondTransport });
    await expect(result.current.actions.submit()).resolves.toMatchObject({
      ok: false,
    });
    expect(idempotencyKeys).toHaveLength(1);

    await act(async () => {
      releaseFirst({ data: { error: "일시 오류" }, ok: false, status: 503 });
      await expect(first).resolves.toMatchObject({ ok: false });
    });
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    await act(async () => {
      await expect(result.current.actions.submit()).resolves.toMatchObject({
        ok: true,
      });
    });

    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
  });
});
