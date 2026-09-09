/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { VocabAssignmentQueueSummary } from "@/lib/admin/vocab-assignment-queue";

import { StudentAssignmentQueueHistory } from "./student-assignment-queue-history";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
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
  it.each([false, true])("복구 GET이 먼저 끝나도 2페이지 처리 중 묶음을 보존한다: 응답유실%s", async lost => {
    const user = userEvent.setup();
    const attention = (id: string, label: string): VocabAssignmentQueueSummary => {
      const base = queue(id, label, "2026-09-10T00:00:00.000Z");
      return { ...base, status: "attention", items: base.items.map(item => ({ ...item, status: "attention" })) };
    };
    const a = attention("00000000-0000-4000-8000-000000000031", "A페이지"), b = attention("00000000-0000-4000-8000-000000000032", "B페이지");
    const freshB: VocabAssignmentQueueSummary = { ...b, status: "deferred", updatedAt: "2026-09-10T01:00:00.000Z",
      items: b.items.map(item => ({ ...item, status: "deferred" })) };
    let finishB!: (response: unknown) => void, failB!: (error: Error) => void;
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ queues: [a], nextCursor: { seriesId: a.seriesId, updatedAt: a.updatedAt } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ queues: [b] }) })
      .mockImplementationOnce(() => new Promise((resolve, reject) => { finishB = resolve; failB = reject; }))
      .mockRejectedValueOnce(new Error("A 응답 유실"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ queues: [a] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ queues: [freshB, a] }) });
    vi.stubGlobal("fetch", fetchMock); vi.spyOn(window, "confirm").mockReturnValue(true);
    const changed = vi.fn(); render(<StudentAssignmentQueueHistory studentId={a.studentId} onHistoryChanged={changed} />);
    await user.click(await screen.findByRole("button", { name: "이전 이력 더 보기" }));
    const article = (name: RegExp) => within(screen.getByRole("button", { name }).closest("article")!);
    await user.click(article(/B페이지/).getByRole("button", { name: "이 회차 보류" }));
    await user.click(article(/A페이지/).getByRole("button", { name: "이 회차 보류" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    await waitFor(() => expect(screen.queryByText("최신 배정 내역을 확인하는 중입니다.")).toBeNull());
    expect(screen.getByRole("button", { name: /B페이지/ })).toBeInTheDocument();
    await act(async () => {
      if (lost) failB(new Error("B 응답 유실"));
      else finishB({ ok: true, json: async () => ({ queue: freshB, version: freshB.updatedAt,
        resolution: { action: "skip", item_id: b.items[0]!.id, series_id: b.seriesId, student_id: b.studentId } }) });
    });
    await waitFor(() => expect(article(/B페이지/).queryByRole("button", { name: "이 회차 보류" })).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(lost ? 6 : 5);
    expect(fetchMock.mock.calls.filter(c => c[1]?.method === "PATCH")).toHaveLength(2);
    // A recovery and B completion/recovery each refresh the separate exam list.
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it("이미 보낸 다른 묶음의 성공 결과를 늦은 복구 조회가 되돌리지 않는다", async () => {
    const user = userEvent.setup();
    const attention = (n: string, label: string): VocabAssignmentQueueSummary => {
      const base = queue("00000000-0000-4000-8000-0000000000" + n, label, "2026-09-10T00:00:00.000Z");
      return { ...base, status: "attention", attentionReason: "assignment_expired", items: base.items.map(item => ({ ...item, status: "attention", attentionReason: "assignment_expired" })) };
    };
    const a = attention("31", "A단어장"), b = attention("32", "B단어장");
    const freshB: VocabAssignmentQueueSummary = { ...b, status: "deferred", attentionReason: null, updatedAt: "2026-09-10T01:00:00.000Z",
      items: b.items.map(item => ({ ...item, status: "deferred", attentionReason: null })) };
    let finishB!: (response: unknown) => void, finishGet!: (response: unknown) => void;
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ queues: [a, b] }) })
      .mockImplementationOnce(() => new Promise(resolve => { finishB = resolve; }))
      .mockRejectedValueOnce(new Error("통신이 끊겼습니다"))
      .mockImplementationOnce(() => new Promise(resolve => { finishGet = resolve; }));
    vi.stubGlobal("fetch", fetchMock); vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<StudentAssignmentQueueHistory studentId={a.studentId} />);
    const article = (name: RegExp) => within(screen.getByRole("button", { name }).closest("article")!);
    await screen.findByRole("button", { name: /B단어장/ });
    await user.click(article(/B단어장/).getByRole("button", { name: "이 회차 보류" }));
    await user.click(article(/A단어장/).getByRole("button", { name: "이 회차 보류" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(article(/A단어장/).getByRole("button", { name: "이 회차 보류" })).toBeDisabled();
    await act(async () => finishB({ ok: true, json: async () => ({ queue: freshB, version: freshB.updatedAt,
      resolution: { action: "skip", item_id: b.items[0]!.id, series_id: b.seriesId, student_id: b.studentId } }) }));
    expect(article(/B단어장/).queryByRole("button", { name: "이 회차 보류" })).toBeNull();
    await act(async () => finishGet({ ok: true, json: async () => ({ queues: [a, b] }) }));
    expect(article(/B단어장/).queryByRole("button", { name: "이 회차 보류" })).toBeNull();
    expect(article(/A단어장/).getByRole("button", { name: "이 회차 보류" })).toBeEnabled();
    expect(fetchMock.mock.calls.filter(c => c[1]?.method === "PATCH")).toHaveLength(2);
  });

  it("기존 내역이 있어도 복구 실패 후 GET만 다시 불러오며 처리를 잠근다", async () => {
    const user = userEvent.setup(); const base = queue("00000000-0000-4000-8000-000000000034", "재조회 단어장", "2026-09-10T00:00:00.000Z");
    const attention: VocabAssignmentQueueSummary = { ...base, status: "attention", items: base.items.map(item => ({ ...item, status: "attention" })) };
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ queues: [attention] }) })
      .mockRejectedValueOnce(new Error("명령 응답 유실"))
      .mockRejectedValueOnce(new Error("내역 조회 실패"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ queues: [base] }) });
    vi.stubGlobal("fetch", fetchMock); vi.spyOn(window, "confirm").mockReturnValue(true);
    const changed = vi.fn();
    render(<StudentAssignmentQueueHistory studentId={base.studentId} onHistoryChanged={changed} />);
    await user.click(await screen.findByRole("button", { name: "이 회차 보류" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("내역 조회 실패");
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "이 회차 보류" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByRole("button", { name: "이 회차 보류" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.filter(c => c[1]?.method === "PATCH")).toHaveLength(1);
    expect(changed).toHaveBeenCalledTimes(1);
  });
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
            item_id: resolved.items[0]!.id,
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
    const recoveredBase = queue(
      base.seriesId,
      "복구 완료",
      "2026-08-22T03:00:00.000Z",
    );
    const recovered: VocabAssignmentQueueSummary = {
      ...recoveredBase, status: "active",
      items: recoveredBase.items.map(item => ({ ...item, status: "assigned",
        assignmentId: "00000000-0000-4000-8000-000000000035", completedAt: null })),
    };
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

    const changed = vi.fn();
    render(<StudentAssignmentQueueHistory studentId={base.studentId} onHistoryChanged={changed} />);
    await user.click(await screen.findByRole("button", {
      name: "같은 회차 다시 배정",
    }));

    expect(await screen.findByText(/복구 완료/)).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.filter(([, options]) =>
      (options as RequestInit | undefined)?.method === "PATCH"
    )).toHaveLength(1);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
// Business-flow tests inject a decision; confirmation rendering/cancellation has separate real-provider tests.
vi.mock("@/design-system/patterns/confirmation/confirmation", async (importOriginal) => {
  const decide = async (options: { message: string }) => window.confirm(options.message);
  return { ...await importOriginal<typeof import("@/design-system/patterns/confirmation/confirmation")>(), useConfirmation: () => decide };
});
