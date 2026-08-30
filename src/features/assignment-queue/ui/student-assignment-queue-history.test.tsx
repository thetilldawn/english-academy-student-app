/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { VocabAssignmentQueueSummary } from "@/lib/admin/vocab-assignment-queue";

import { StudentAssignmentQueueHistory } from "./student-assignment-queue-history";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function queue(seriesId: string, datasetLabel: string, updatedAt: string) {
  return {
    attentionReason: null,
    completedSessionCount: 1,
    createdAt: updatedAt,
    currentAssignmentId: null,
    datasetLabel,
    items: [
      {
        assignmentId: null,
        attentionReason: null,
        completedAt: updatedAt,
        effectiveAvailableFrom: updatedAt,
        effectiveAvailableUntil: updatedAt,
        id: seriesId,
        materializedAt: updatedAt,
        plannedAvailableFrom: updatedAt,
        plannedAvailableUntil: updatedAt,
        questionCount: 20,
        sequenceNumber: 1,
        status: "completed" as const,
        unitLabels: ["DAY 1"],
      },
    ],
    nextAvailableFrom: null,
    nextAvailableUntil: null,
    rangeLabel: "DAY 1",
    remainingQuestionCount: 0,
    remainingSessionCount: 0,
    seriesId,
    status: "completed" as const,
    studentId: "00000000-0000-4000-8000-000000000020",
    totalQuestionCount: 20,
    totalSessionCount: 1,
    unitAllocation: null,
    updatedAt,
  } satisfies VocabAssignmentQueueSummary;
}

describe("StudentAssignmentQueueHistory", () => {
  it("학생별 이력을 묶음 단위로 더 불러와 기존 목록 뒤에 붙인다", async () => {
    const user = userEvent.setup();
    const first = queue(
      "00000000-0000-4000-8000-000000000031",
      "최근 단어장",
      "2026-08-22T02:00:00.000Z",
    );
    const second = queue(
      "00000000-0000-4000-8000-000000000032",
      "이전 단어장",
      "2026-08-21T02:00:00.000Z",
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          nextCursor: {
            seriesId: first.seriesId,
            updatedAt: first.updatedAt,
          },
          queues: [first],
        }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({ nextCursor: null, queues: [second] }),
        ok: true,
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<StudentAssignmentQueueHistory studentId={first.studentId} />);
    expect(await screen.findByText(/최근 단어장/)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "이전 이력 더 보기" }),
    );
    expect(await screen.findByText(/이전 단어장/)).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1]![0])).toContain(
      `beforeSeriesId=${first.seriesId}`,
    );
  });

  it("큐 처리 성공은 같은 묶음만 교체하고 페이지 전체를 다시 읽지 않는다", async () => {
    const user = userEvent.setup();
    const base = queue(
      "00000000-0000-4000-8000-000000000033",
      "복구 단어장",
      "2026-08-22T02:00:00.000Z",
    );
    const attention = {
      ...base,
      attentionReason: "assignment_expired",
      status: "attention" as const,
      items: base.items.map((entry) => ({
        ...entry,
        attentionReason: "assignment_expired",
        status: "attention" as const,
      })),
    };
    const resolved = {
      ...attention,
      attentionReason: null,
      status: "active" as const,
      updatedAt: "2026-08-22T03:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ nextCursor: null, queues: [attention] }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({
          queue: resolved,
          resolution: {
            action: "retry",
            series_id: resolved.seriesId,
            student_id: resolved.studentId,
          },
          version: resolved.updatedAt,
        }),
        ok: true,
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<StudentAssignmentQueueHistory studentId={base.studentId} />);
    await screen.findByRole("button", { name: "같은 회차 다시 배정" });
    await user.click(
      screen.getByRole("button", { name: "같은 회차 다시 배정" }),
    );

    await waitFor(() => expect(
      screen.getByRole("button", { name: /배정된 시험 · 복구 단어장/ }),
    ).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      `/api/admin/vocab-assignment-queues/${base.seriesId}`,
    );
  });

  it("응답을 잃으면 명령을 반복하지 않고 최신 첫 페이지만 복구한다", async () => {
    const user = userEvent.setup();
    const base = queue(
      "00000000-0000-4000-8000-000000000034",
      "복구 전",
      "2026-08-22T02:00:00.000Z",
    );
    const attention = {
      ...base,
      attentionReason: "assignment_expired",
      status: "attention" as const,
      items: base.items.map((entry) => ({
        ...entry,
        attentionReason: "assignment_expired",
        status: "attention" as const,
      })),
    };
    const recovered = queue(
      base.seriesId,
      "복구 완료",
      "2026-08-22T03:00:00.000Z",
    );
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        json: async () => ({ nextCursor: null, queues: [attention] }),
        ok: true,
      })
      .mockRejectedValueOnce(new Error("응답 유실"))
      .mockResolvedValueOnce({
        json: async () => ({ nextCursor: null, queues: [recovered] }),
        ok: true,
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<StudentAssignmentQueueHistory studentId={base.studentId} />);
    await user.click(await screen.findByRole("button", {
      name: "같은 회차 다시 배정",
    }));

    expect(await screen.findByText(/복구 완료/)).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.filter(([, options]) =>
      (options as RequestInit | undefined)?.method === "PATCH"
    )).toHaveLength(1);
  });
});
