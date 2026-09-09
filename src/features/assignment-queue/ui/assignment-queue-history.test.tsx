/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import type { VocabAssignmentQueueSummary } from "@/lib/admin/vocab-assignment-queue";

import { AssignmentQueueHistory } from "./assignment-queue-history";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function queue(
  status: VocabAssignmentQueueSummary["status"],
  seriesId: string,
): VocabAssignmentQueueSummary {
  const completed = status === "completed";
  const attention = status === "attention";
  return {
    attentionReason: attention ? "assignment_expired" : null,
    completedSessionCount: completed ? 3 : 1,
    createdAt: "2026-08-22T00:00:00.000Z",
    currentAssignmentId: completed
      ? null
      : "00000000-0000-4000-8000-000000000021",
    datasetLabel: "능률 VOCA 고교필수",
    items: [
      {
        assignmentId: "00000000-0000-4000-8000-000000000021",
        attentionReason: null,
        completedAt: completed ? "2026-08-22T01:00:00.000Z" : null,
        effectiveAvailableFrom: "2026-08-22T00:00:00.000Z",
        effectiveAvailableUntil: "2026-08-22T01:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000022",
        materializedAt: "2026-08-21T23:00:00.000Z",
        plannedAvailableFrom: "2026-08-22T00:00:00.000Z",
        plannedAvailableUntil: "2026-08-22T01:00:00.000Z",
        questionCount: 20,
        sequenceNumber: 1,
        status: completed ? "completed" : attention ? "attention" : "assigned",
        unitLabels: ["DAY 1~2"],
      },
    ],
    nextAvailableFrom: completed ? null : "2026-08-22T00:00:00.000Z",
    nextAvailableUntil: completed ? null : "2026-08-22T01:00:00.000Z",
    rangeLabel: "DAY 1~6",
    remainingQuestionCount: completed ? 0 : 40,
    remainingSessionCount: completed ? 0 : 2,
    seriesId,
    status,
    studentId: "00000000-0000-4000-8000-000000000020",
    totalQuestionCount: 60,
    totalSessionCount: 3,
    unitAllocation: status === "active"
      ? {
          mode: "by_weekday",
          unitsPerSession: 1,
          weekdayUnitsPerSession: {
            1: 2, 2: 1, 3: 3, 4: 1, 5: 1, 6: 1, 7: 1,
          },
          recurrenceWeekdays: [1, 3],
        }
      : null,
    updatedAt: "2026-08-22T01:00:00.000Z",
  };
}

describe("AssignmentQueueHistory", () => {
  it("정상 응답이어도 재배정이 멈춰 있으면 성공 대신 확인 안내와 최신 상태를 반영한다", async () => {
    const user = userEvent.setup(); const before = queue("attention", "00000000-0000-4000-8000-000000000033");
    const after = { ...before, attentionReason: "release_schedule_conflict", updatedAt: "2026-09-10T01:00:00.000Z",
      items: before.items.map(item => ({ ...item, attentionReason: "release_schedule_conflict" })) };
    const onResolved = vi.fn(), onError = vi.fn();
    const receipt = { queue: after, version: after.updatedAt, resolution: { action: "retry", item_id: after.items[0]!.id,
      series_id: after.seriesId, student_id: after.studentId } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => receipt }));
    vi.spyOn(window, "confirm").mockReturnValue(true); vi.mocked(toast.warning).mockClear(); vi.mocked(toast.success).mockClear();
    render(<AssignmentQueueHistory queues={[before]} onResolved={onResolved} onResolutionError={onError} />);
    await user.click(screen.getByRole("button", { name: "같은 회차 다시 배정" }));
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(receipt));
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("처리가 완료되지 않았습니다"));
    expect(toast.success).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
  });
  it("확인 직후 화면을 닫으면 이미 끝난 승인으로 요청하지 않는다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(<AssignmentQueueHistory queues={[queue("attention", "00000000-0000-4000-8000-000000000033")]} />);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "이 회차 보류" }));
      unmount();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("확인 도중 회차 버전이 바뀌면 이전 요청은 버리고 새 버튼은 사용할 수 있다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const item = queue("attention", "00000000-0000-4000-8000-000000000033");
    const { rerender } = render(<AssignmentQueueHistory queues={[item]} />);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "이 회차 보류" }));
      rerender(<AssignmentQueueHistory queues={[{ ...item, updatedAt: "2026-08-23T00:00:00.000Z" }]} />);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "이 회차 보류" })).toBeEnabled();
  });
  it("건너뛰기를 보류로 설명하고 확인을 취소하면 전송하지 않는다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AssignmentQueueHistory queues={[queue("attention", "00000000-0000-4000-8000-000000000033")]} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "이 회차 보류" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("보류"));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("예약 시간과 마감은 유지"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("진행 큐는 펼치고 완료 큐는 접은 채 핵심 정보만 요약한다", async () => {
    const user = userEvent.setup();
    render(
      <AssignmentQueueHistory
        queues={[
          queue("active", "00000000-0000-4000-8000-000000000031"),
          queue("completed", "00000000-0000-4000-8000-000000000032"),
        ]}
      />,
    );
    expect(screen.getByText(/요일별 월 2 · 수 3단위/)).toBeVisible();

    const active = screen.getByRole("button", { name: /배정된 시험/ });
    const completed = screen.getByRole("button", { name: /완료/ });
    expect(active).toHaveAttribute("aria-expanded", "true");
    expect(completed).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(completed.getAttribute("aria-controls")!))
      .toHaveAttribute("aria-hidden", "true");
    expect(document.getElementById(completed.getAttribute("aria-controls")!))
      .toHaveAttribute("inert");
    expect(active).toHaveTextContent("능률 VOCA 고교필수");
    expect(active).toHaveTextContent("DAY 1~6");
    expect(active).toHaveTextContent("2회 · 40개 남음");
    expect(active).toHaveTextContent("40개 남음");

    await user.click(completed);
    expect(completed).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(completed.getAttribute("aria-controls")!))
      .toHaveAttribute("aria-hidden", "false");
    expect(document.getElementById(completed.getAttribute("aria-controls")!))
      .not.toHaveAttribute("inert");
  });

  it("확인 필요 큐에서 같은 회차 재배정 영수증을 부모에 전달한다", async () => {
    const user = userEvent.setup();
    const resolvedQueue = queue(
      "active",
      "00000000-0000-4000-8000-000000000033",
    );
    const resolution = {
      queue: resolvedQueue,
      resolution: {
        action: "retry" as const,
        item_id: resolvedQueue.items[0]!.id,
        series_id: resolvedQueue.seriesId,
        student_id: resolvedQueue.studentId,
      },
      version: resolvedQueue.updatedAt,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => resolution,
      ok: true,
    });
    const onResolved = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <AssignmentQueueHistory
        onResolved={onResolved}
        queues={[
          queue("attention", "00000000-0000-4000-8000-000000000033"),
        ]}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "같은 회차 다시 배정" }),
    );
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(resolution));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/vocab-assignment-queues/00000000-0000-4000-8000-000000000033",
      expect.objectContaining({
        body: JSON.stringify({ action: "retry", expectedItemId: resolvedQueue.items[0]!.id }),
        method: "PATCH",
      }),
    );
  });
});
// Business-flow tests inject a decision; confirmation rendering/cancellation has separate real-provider tests.
vi.mock("@/design-system/patterns/confirmation/confirmation", async (importOriginal) => {
  const decide = async (options: { message: string }) => window.confirm(options.message);
  return { ...await importOriginal<typeof import("@/design-system/patterns/confirmation/confirmation")>(), useConfirmation: () => decide };
});
