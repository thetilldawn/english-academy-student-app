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
    expect(await screen.findByText("최근 단어장")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "이전 이력 더 보기" }),
    );
    expect(await screen.findByText("이전 단어장")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1]![0])).toContain(
      `beforeSeriesId=${first.seriesId}`,
    );
  });
});
