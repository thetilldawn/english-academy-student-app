// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { assignmentContractIds, reverseUnitIds } from "@/test-support/assignment-contract-fixtures";

import type { AssignmentTransport } from "./assignment-transport";
import {
  createInitialSingleAssignmentDraft,
  useAssignmentController,
} from "./use-assignment-controller";

const capacity = {
  activeAssignmentExcluded: 0,
  alreadyAssigned: 0,
  eligibleBeforeActiveAssignment: 40,
  maximumQuestionCount: 40,
  minimumQuestionCount: 4,
  overlap: 0,
  questionPlanExcluded: 0,
  recommendedQuestionCount: 40,
  unitEligible: 40,
  wrongEligible: 4,
  wrongLevel1Eligible: 3,
  wrongLevel2Eligible: 1,
};

function createDraft() {
  return createInitialSingleAssignmentDraft({
    datasetId: assignmentContractIds.dataset,
    orderedUnitIds: reverseUnitIds,
    studentId: assignmentContractIds.studentA,
  });
}

function renderController(
  transport: AssignmentTransport,
  clock: () => number = () => Date.now(),
) {
  return renderHook(() =>
    useAssignmentController({
      automaticTitleForDraft: () => "자동 시험",
      capacityErrorMessage: "출제 가능 수를 확인하지 못했습니다.",
      clock,
      editLoadErrorMessage: "수정안을 불러오지 못했습니다.",
      genericErrorMessage: "배정하지 못했습니다.",
      previewDelayMs: 0,
      source: { initialDraft: createDraft(), kind: "create" },
      transport,
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("single assignment controller", () => {
  it("creates a new draft from the complete inherited exam defaults", () => {
    expect(
      createInitialSingleAssignmentDraft({
        datasetId: assignmentContractIds.dataset,
        deadline: {
          mode: "at",
          koreanLocalDateTime: "2026-08-13T18:00",
        },
        exam: {
          directionRatio: 100,
          passingScore: 85,
          questionOrderMode: "descending",
          timing: { mode: "per_question", perQuestionSeconds: 12 },
        },
        orderedUnitIds: reverseUnitIds,
        studentId: assignmentContractIds.studentA,
      }),
    ).toMatchObject({
      deadline: {
        mode: "at",
        koreanLocalDateTime: "2026-08-13T18:00",
      },
      exam: {
        directionRatio: 100,
        passingScore: 85,
        questionOrderMode: "descending",
        timing: { mode: "per_question", perQuestionSeconds: 12 },
      },
      range: { orderedUnitIds: reverseUnitIds },
    });
  });

  it("aborts an obsolete capacity request and ignores its late response", async () => {
    let capacityRequestCount = 0;
    let firstSignal: AbortSignal | undefined;
    let resolveFirst: (
      value: Awaited<ReturnType<AssignmentTransport>>,
    ) => void = () => {};
    const firstResponse = new Promise<
      Awaited<ReturnType<AssignmentTransport>>
    >((resolve) => {
      resolveFirst = resolve;
    });
    const transport: AssignmentTransport = vi.fn(async (request) => {
      if (request.url === "/api/admin/assignment-capacity") {
        capacityRequestCount += 1;
        if (capacityRequestCount === 1) {
          firstSignal = request.signal;
          return firstResponse;
        }
        return {
          data: {
            ...capacity,
            maximumQuestionCount: 12,
            recommendedQuestionCount: 12,
            unitEligible: 12,
          },
          ok: true,
          status: 200,
        };
      }
      return {
        data: { assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        ok: true,
        status: 201,
      };
    });
    const { result } = renderController(transport);
    await waitFor(() => expect(capacityRequestCount).toBe(1));

    act(() => {
      result.current.actions.changeRange(assignmentContractIds.dataset, [
        assignmentContractIds.day57,
      ]);
    });
    await waitFor(() => expect(capacityRequestCount).toBe(2));
    expect(firstSignal?.aborted).toBe(true);
    await waitFor(() =>
      expect(result.current.capacity?.maximumQuestionCount).toBe(12),
    );

    await act(async () => {
      resolveFirst({
        data: {
          ...capacity,
          maximumQuestionCount: 99,
          recommendedQuestionCount: 99,
          unitEligible: 99,
        },
        ok: true,
        status: 200,
      });
      await firstResponse;
    });
    expect(result.current.capacity?.maximumQuestionCount).toBe(12);
  });

  it("preserves each timing value while switching timing modes", async () => {
    const transport: AssignmentTransport = vi.fn(async (request) =>
      request.url === "/api/admin/assignment-capacity"
        ? { data: capacity, ok: true, status: 200 }
        : {
            data: { assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
            ok: true,
            status: 201,
          },
    );
    const { result } = renderController(transport);
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    act(() => {
      result.current.actions.changeTiming({
        mode: "total",
        totalSeconds: 720,
      });
      result.current.actions.changeTimingMode("per_question");
    });
    expect(result.current.state.draft.exam.timing).toStrictEqual({
      mode: "per_question",
      perQuestionSeconds: 20,
    });

    act(() => {
      result.current.actions.changeTiming({
        mode: "per_question",
        perQuestionSeconds: 37,
      });
      result.current.actions.changeTimingMode("total");
    });
    expect(result.current.state.draft.exam.timing).toStrictEqual({
      mode: "total",
      totalSeconds: 720,
    });

    act(() => result.current.actions.changeTimingMode("per_question"));
    expect(result.current.state.draft.exam.timing).toStrictEqual({
      mode: "per_question",
      perQuestionSeconds: 37,
    });
  });

  it("submits manual count, per-question timing, and a Korean-local deadline", async () => {
    const requests: Parameters<AssignmentTransport>[0][] = [];
    const transport: AssignmentTransport = vi.fn(async (request) => {
      requests.push(request);
      if (request.url === "/api/admin/assignment-capacity") {
        return { data: capacity, ok: true, status: 200 };
      }
      return {
        data: { assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        ok: true,
        status: 201,
      };
    });
    const { result } = renderController(transport);
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    act(() => {
      result.current.actions.changeQuestionCount(12);
      result.current.actions.changeTiming({
        mode: "per_question",
        perQuestionSeconds: 15,
      });
      result.current.actions.changeDeadline({
        mode: "at",
        koreanLocalDateTime: "2099-08-10T18:30",
      });
    });
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({ ok: true });
    });

    expect(requests.at(-1)).toMatchObject({
      body: {
        availableUntil: "2099-08-10T09:30:00.000Z",
        questionCount: 12,
        questionTimeLimitSeconds: 15,
        timingMode: "per_question",
      },
      url: "/api/admin/assignments",
    });
  });

  it("does not refetch capacity for settings that do not affect eligibility", async () => {
    let capacityRequestCount = 0;
    const transport: AssignmentTransport = vi.fn(async (request) => {
      if (request.url === "/api/admin/assignment-capacity") {
        capacityRequestCount += 1;
        return { data: capacity, ok: true, status: 200 };
      }
      return {
        data: { assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        ok: true,
        status: 201,
      };
    });
    const { result } = renderController(transport);
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    act(() => result.current.actions.changeQuestionCount(40));
    expect(result.current.state.draft.questionCount).toStrictEqual({
      mode: "manual",
      value: 40,
    });
    act(() => result.current.actions.restoreAutomaticCount());
    expect(result.current.state.draft.questionCount).toStrictEqual({
      mode: "automatic",
      value: 40,
    });

    act(() => {
      result.current.actions.changeTitle("직접 정한 이름");
      result.current.actions.changeQuestionCount(12);
      result.current.actions.changeOrder("descending");
      result.current.actions.changeTiming({
        mode: "per_question",
        perQuestionSeconds: 17,
      });
      result.current.actions.changePassingScore(90);
      result.current.actions.changeDeadline({
        mode: "at",
        koreanLocalDateTime: "2099-08-10T18:30",
      });
    });
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    expect(capacityRequestCount).toBe(1);
  });

  it("blocks direct submission when the verified capacity cannot satisfy the minimum", async () => {
    let assignmentRequestCount = 0;
    const transport: AssignmentTransport = vi.fn(async (request) => {
      if (request.url === "/api/admin/assignment-capacity") {
        return {
          data: {
            ...capacity,
            maximumQuestionCount: 3,
            minimumQuestionCount: 4,
            recommendedQuestionCount: 3,
            unitEligible: 3,
          },
          ok: true,
          status: 200,
        };
      }
      assignmentRequestCount += 1;
      return {
        data: { assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        ok: true,
        status: 201,
      };
    });
    const { result } = renderController(transport);
    await waitFor(() => expect(result.current.state.preview.status).toBe("ready"));

    let outcome: Awaited<ReturnType<typeof result.current.actions.submit>>;
    await act(async () => {
      outcome = await result.current.actions.submit();
    });

    expect(outcome!).toMatchObject({ ok: false });
    expect(result.current.canSubmit).toBe(false);
    expect(assignmentRequestCount).toBe(0);
  });

  it("sends only one request when submit is invoked twice", async () => {
    let assignmentRequestCount = 0;
    let releaseRequest = () => {};
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const transport: AssignmentTransport = vi.fn(async (request) => {
      if (request.url === "/api/admin/assignment-capacity") {
        return { data: capacity, ok: true, status: 200 };
      }
      assignmentRequestCount += 1;
      await requestGate;
      return {
        data: { assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        ok: true,
        status: 201,
      };
    });
    const { result } = renderController(transport);
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    let firstRequest!: ReturnType<typeof result.current.actions.submit>;
    act(() => {
      firstRequest = result.current.actions.submit();
    });
    await waitFor(() =>
      expect(result.current.state.submission.status).toBe("submitting"),
    );
    let duplicateOutcome: Awaited<
      ReturnType<typeof result.current.actions.submit>
    >;
    await act(async () => {
      duplicateOutcome = await result.current.actions.submit();
    });
    expect(duplicateOutcome!).toMatchObject({ ok: false });
    expect(assignmentRequestCount).toBe(1);

    await act(async () => {
      releaseRequest();
      expect(await firstRequest).toMatchObject({ ok: true });
    });
    expect(result.current.canSubmit).toBe(false);
  });

  it("surfaces a past deadline before the user submits", async () => {
    const transport: AssignmentTransport = vi.fn(async (request) =>
      request.url === "/api/admin/assignment-capacity"
        ? { data: capacity, ok: true, status: 200 }
        : {
            data: { assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
            ok: true,
            status: 201,
          },
    );
    const clock = () => Date.parse("2026-08-10T04:00:00.000Z");
    const { result } = renderController(transport, clock);
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    act(() => {
      result.current.actions.changeDeadline({
        mode: "at",
        koreanLocalDateTime: "2026-08-10T12:00",
      });
    });

    expect(result.current.canSubmit).toBe(false);
    expect(result.current.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "응시 마감은 현재 시각보다 뒤로 정해 주세요.",
          path: "deadline",
        }),
      ]),
    );
  });

  it("uses the same reverse DAY order for capacity and regular submission", async () => {
    const requests: Parameters<AssignmentTransport>[0][] = [];
    const transport: AssignmentTransport = vi.fn(async (request) => {
      requests.push(request);
      if (request.url === "/api/admin/assignment-capacity") {
        return { data: capacity, ok: true, status: 200 };
      }
      return {
        data: { assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        ok: true,
        status: 201,
      };
    });
    const { result } = renderController(transport);

    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    let outcome: Awaited<ReturnType<typeof result.current.actions.submit>>;
    await act(async () => {
      outcome = await result.current.actions.submit();
    });

    expect(outcome!).toMatchObject({ ok: true });
    expect(requests[0]).toMatchObject({
      body: { primaryUnitIds: reverseUnitIds },
      url: "/api/admin/assignment-capacity",
    });
    expect(requests[1]).toMatchObject({
      body: { unitIds: reverseUnitIds },
      url: "/api/admin/assignments",
    });
  });

  it("keeps review scope and levels when creating a mixed assignment", async () => {
    const requests: Parameters<AssignmentTransport>[0][] = [];
    const transport: AssignmentTransport = vi.fn(async (request) => {
      requests.push(request);
      if (request.url === "/api/admin/assignment-capacity") {
        return { data: capacity, ok: true, status: 200 };
      }
      return {
        data: { assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        ok: true,
        status: 201,
      };
    });
    const { result } = renderController(transport);
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    act(() => {
      result.current.actions.changeReviewMode("pending");
      result.current.actions.changeReviewScope("selection");
      result.current.actions.toggleReviewLevel(1);
    });
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    await act(async () => {
      await result.current.actions.submit();
    });

    expect(requests.at(-1)).toMatchObject({
      body: {
        primaryUnitIds: reverseUnitIds,
        reviewLevels: [2],
        reviewScope: "selection",
      },
      url: "/api/admin/mixed-assignments",
    });
  });

  it("keeps the draft, refreshes capacity, and allows retry after a 409", async () => {
    let submitCount = 0;
    let capacityCount = 0;
    const onConflict = vi.fn();
    const transport: AssignmentTransport = vi.fn(async (request) => {
      if (request.url === "/api/admin/assignment-capacity") {
        capacityCount += 1;
        return { data: capacity, ok: true, status: 200 };
      }
      submitCount += 1;
      if (submitCount === 1) {
        return { data: { error: "출제 가능 수가 바뀌었습니다." }, ok: false, status: 409 };
      }
      return {
        data: { assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        ok: true,
        status: 201,
      };
    });
    const { result } = renderHook(() =>
      useAssignmentController({
        automaticTitleForDraft: () => "자동 시험",
        capacityErrorMessage: "출제 가능 수를 확인하지 못했습니다.",
        editLoadErrorMessage: "수정안을 불러오지 못했습니다.",
        genericErrorMessage: "배정하지 못했습니다.",
        onConflict,
        previewDelayMs: 0,
        source: { initialDraft: createDraft(), kind: "create" },
        transport,
      }),
    );
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    const before = result.current.state.draft;

    let conflict: Awaited<ReturnType<typeof result.current.actions.submit>>;
    await act(async () => {
      conflict = await result.current.actions.submit();
    });
    expect(conflict!).toMatchObject({ conflict: true, ok: false });
    expect(result.current.state.draft).toStrictEqual(before);
    expect(onConflict).toHaveBeenCalledOnce();
    await waitFor(() => expect(capacityCount).toBe(2));
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({ ok: true });
    });
    expect(submitCount).toBe(2);
  });

  it.each([
    { includePendingReview: false, purpose: "regular" as const },
    { includePendingReview: true, purpose: "mixed" as const },
  ])("hydrates and replaces a $purpose assignment through the shared controller", async ({
    includePendingReview,
    purpose,
  }) => {
    const requests: Parameters<AssignmentTransport>[0][] = [];
    const assignmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const transport: AssignmentTransport = vi.fn(async (request) => {
      requests.push(request);
      if (request.method === "GET") {
        return {
          data: {
            assignmentId,
            availableUntil: null,
            datasetId: assignmentContractIds.dataset,
            englishToKoreanRatio: 50,
            includePendingReview,
            passingScore: 80,
            primaryUnitIds: [...reverseUnitIds],
            purpose,
            questionCount: 12,
            questionOrderMode: "random",
            questionTimeLimitSeconds: null,
            reviewLevels: includePendingReview ? [1, 2] : [],
            studentId: assignmentContractIds.studentA,
            studentName: "학생",
            timeLimitSeconds: 300,
            timingMode: "total",
            title: "기존 단어 시험",
          },
          ok: true,
          status: 200,
        };
      }
      if (request.method === "POST") {
        return { data: capacity, ok: true, status: 200 };
      }
      return {
        data: {
          idempotent: false,
          replacementAssignmentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          replacementPurpose: purpose,
          sourceAssignmentId: assignmentId,
          status: "replaced",
          studentId: assignmentContractIds.studentA,
        },
        ok: true,
        status: 200,
      };
    });
    const { result } = renderHook(() =>
      useAssignmentController({
        automaticTitleForDraft: () => "자동 시험",
        capacityErrorMessage: "capacity error",
        editLoadErrorMessage: "edit error",
        genericErrorMessage: "submit error",
        previewDelayMs: 0,
        source: {
          assignmentId,
          fallbackDraft: createDraft(),
          kind: "edit",
          studentId: assignmentContractIds.studentA,
        },
        transport,
      }),
    );
    await waitFor(() => expect(result.current.state.preview.status).toBe("ready"));
    expect(result.current.canSubmit).toBe(false);
    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({ ok: false });
    });
    expect(requests.filter((request) => request.method === "PUT")).toHaveLength(0);

    act(() => result.current.actions.changePassingScore(85));
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({ ok: true });
    });

    expect(requests.at(-1)).toMatchObject({
      body: {
        includePendingReview,
        passingScore: 85,
        primaryUnitIds: reverseUnitIds,
      },
      method: "PUT",
      url: `/api/admin/assignments/${assignmentId}/students/${assignmentContractIds.studentA}`,
    });
  });

  it("hydrates and locks the exact-review range while allowing settings edits", async () => {
    const requests: Parameters<AssignmentTransport>[0][] = [];
    const assignmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const editResponse = {
      assignmentId,
      availableUntil: null,
      datasetId: assignmentContractIds.dataset,
      englishToKoreanRatio: 0,
      includePendingReview: true,
      passingScore: 80,
      primaryUnitIds: [...reverseUnitIds],
      purpose: "review" as const,
      questionCount: 1,
      questionOrderMode: "ascending" as const,
      questionTimeLimitSeconds: 20,
      reviewLevels: [2] as const,
      studentId: assignmentContractIds.studentA,
      studentName: "학생",
      timeLimitSeconds: 10800,
      timingMode: "per_question" as const,
      title: "기존 오답 재시험",
    };
    const transport: AssignmentTransport = vi.fn(async (request) => {
      requests.push(request);
      if (request.method === "GET") {
        return { data: editResponse, ok: true, status: 200 };
      }
      if (request.method === "POST") {
        return {
          data: { ...capacity, minimumQuestionCount: 1, recommendedQuestionCount: 1 },
          ok: true,
          status: 200,
        };
      }
      return {
        data: {
          idempotent: false,
          replacementAssignmentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          replacementPurpose: "review",
          sourceAssignmentId: assignmentId,
          status: "replaced",
          studentId: assignmentContractIds.studentA,
        },
        ok: true,
        status: 200,
      };
    });
    const fallbackDraft = createDraft();
    const { result } = renderHook(() =>
      useAssignmentController({
        automaticTitleForDraft: () => "자동 시험",
        capacityErrorMessage: "capacity error",
        editLoadErrorMessage: "edit error",
        genericErrorMessage: "submit error",
        previewDelayMs: 0,
        source: {
          assignmentId,
          fallbackDraft,
          kind: "edit",
          studentId: assignmentContractIds.studentA,
        },
        transport,
      }),
    );
    await waitFor(() => expect(result.current.isExactReview).toBe(true));
    await waitFor(() => expect(result.current.state.preview.status).toBe("ready"));
    const locked = result.current.state.draft;

    act(() => {
      result.current.actions.changeRange(assignmentContractIds.dataset, [assignmentContractIds.day57]);
      result.current.actions.changeQuestionCount(2);
      result.current.actions.toggleReviewLevel(1);
      result.current.actions.changePassingScore(90);
    });
    expect(result.current.state.draft.range).toStrictEqual(locked.range);
    expect(result.current.state.draft.questionCount.value).toBe(1);
    expect(result.current.state.draft.review.levels).toStrictEqual([2]);
    expect(result.current.state.draft.exam.passingScore).toBe(90);
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({ ok: true });
    });
    expect(requests.at(-1)).toMatchObject({ method: "PUT" });
  });
});
