// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminHistoryListItem } from "@/features/history/contracts/admin-history-read-model";
import {
  loadAdminHistoryFreshSection,
  loadAdminHistoryNextPage,
  loadAdminHistorySnapshot,
} from "@/features/history/transport/history-pages";

import { useAdminHistorySectionPage } from "./use-admin-history-section-page";
import { AdminHistoryRequestError } from "../contracts/admin-history-request-error";

vi.mock("@/features/history/transport/history-pages", () => ({
  loadAdminHistoryFreshSection: vi.fn(),
  loadAdminHistoryNextPage: vi.fn(),
  loadAdminHistorySnapshot: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function item(id: string) {
  return { id } as AdminHistoryListItem;
}

function hiddenNotice(version: string) {
  return {
    after: null,
    before: {
      activityAt: "2026-08-31T00:00:00.000Z",
      assignedAt: "2026-08-31T00:00:00.000Z",
      assignmentId: "00000000-0000-4000-8000-000000000010",
      completedAt: "2026-08-31T00:00:00.000Z",
      id: "hidden-entry",
      passingScore: 80,
      passed: true,
      finalScore: 100,
      status: "completed",
      studentId: "00000000-0000-4000-8000-000000000020",
    } as AdminHistoryListItem,
    receipt: {
      assignmentId: "00000000-0000-4000-8000-000000000010",
      attemptId: "00000000-0000-4000-8000-000000000030",
      kind: "hidden" as const,
      studentId: "00000000-0000-4000-8000-000000000020",
      version,
    },
  };
}

describe("admin history section page controller", () => {

  const context = { currentOnly: false, query: "", statusFilter: "all" } as const;
  const initialSection = { groupKey: "completed", items: [item("old")], nextCursor: "old-cursor", totalCount: 11 };

  it("더보기 실패는 현 목록 보존 후 같은 페이지 읽기로 재시도한다", async () => {
    vi.mocked(loadAdminHistoryNextPage).mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ items: [item("more")], nextCursor: null });
    const { result } = renderHook(() => useAdminHistorySectionPage({ loadMoreContext: context, section: initialSection }));
    await act(() => result.current.loadMore());
    expect(result.current.failure).toBe("unavailable");
    expect(result.current.items.map((value) => value.id)).toEqual(["old"]);
    await act(() => result.current.retry());
    expect(result.current.failure).toBeNull();
    expect(result.current.items.map((value) => value.id)).toEqual(["old", "more"]);
    expect(vi.mocked(loadAdminHistoryNextPage).mock.calls.map(([request]) => request.cursor)).toEqual(["old-cursor", "old-cursor"]);
  });

  it("변경 후 실패는 옛 자료/개수/커서를 숨기고 같은 영수증의 읽기만 다시 시도한다", async () => {
    vi.mocked(loadAdminHistoryFreshSection).mockRejectedValueOnce(new Error("private SQL"))
      .mockResolvedValueOnce({ groupKey: "completed", items: [], nextCursor: null, totalCount: 0 });
    const { result } = renderHook(() => useAdminHistorySectionPage({ loadMoreContext: context, section: initialSection }));
    act(() => window.dispatchEvent(new CustomEvent("admin-history:mutated", {
      detail: hiddenNotice("2026-08-31T00:00:03.000Z"),
    })));
    await waitFor(() => expect(result.current.failure).toBe("unavailable"));
    expect(result.current.items).toEqual([]);
    expect(result.current.countKnown).toBe(false);
    expect(result.current.nextCursor).toBeNull();
    await act(() => result.current.retry());
    expect(result.current.failure).toBeNull();
    expect(result.current.countKnown).toBe(true);
    expect(result.current.totalCount).toBe(0);
    expect(vi.mocked(loadAdminHistoryFreshSection).mock.calls.map(([request]) => request.snapshotAt))
      .toEqual(["2026-08-31T00:00:03.000Z", "2026-08-31T00:00:03.000Z"]);
    expect(loadAdminHistoryNextPage).not.toHaveBeenCalled();
  });

  it("거절된 페이지 커서는 재전송하지 않고 서버가 시각을 정한 처음 목록으로 복구한다", async () => {
    vi.mocked(loadAdminHistoryNextPage).mockRejectedValueOnce(new AdminHistoryRequestError("invalid-request"));
    vi.mocked(loadAdminHistorySnapshot).mockResolvedValueOnce({
      ...context, snapshotAt: "2026-09-06T00:00:00.000Z",
      sections: [{ ...initialSection, items: [item("fresh")], nextCursor: "fresh-cursor" }],
    });
    const { result } = renderHook(() => useAdminHistorySectionPage({ loadMoreContext: context, section: initialSection }));
    await act(() => result.current.loadMore());
    expect(result.current.nextCursor).toBeNull();
    await act(() => result.current.retry());
    expect(loadAdminHistorySnapshot).toHaveBeenCalledWith({ ...context, mode: "initial" }, expect.any(AbortSignal));
    expect(loadAdminHistoryNextPage).toHaveBeenCalledOnce();
    expect(result.current.nextCursor).toBe("fresh-cursor");
    expect(result.current.items.map((value) => value.id)).toEqual(["fresh"]);
  });

  it("취소를 무시한 더보기 성공이 변경 뒤 새 구역을 덮지 않는다", async () => {
    let finishOld: ((value: { items: AdminHistoryListItem[]; nextCursor: null }) => void) | undefined;
    vi.mocked(loadAdminHistoryNextPage).mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    vi.mocked(loadAdminHistoryFreshSection).mockResolvedValueOnce({
      groupKey: "completed", items: [item("fresh")], nextCursor: null, totalCount: 1,
    });
    const { result } = renderHook(() => useAdminHistorySectionPage({ loadMoreContext: context, section: initialSection }));
    act(() => void result.current.loadMore());
    act(() => window.dispatchEvent(new CustomEvent("admin-history:mutated", {
      detail: hiddenNotice("2026-08-31T00:00:03.000Z"),
    })));
    await waitFor(() => expect(result.current.items[0]?.id).toBe("fresh"));
    await act(async () => finishOld?.({ items: [item("late")], nextCursor: null }));
    expect(result.current.items.map((value) => value.id)).toEqual(["fresh"]);
  });
  it("다음 페이지를 중복 없이 붙이고 마지막 커서에서 끝낸다", async () => {
    vi.mocked(loadAdminHistoryNextPage).mockResolvedValue({
      items: [item("first"), item("second"), item("second")],
      nextCursor: null,
    });
    const { result } = renderHook(() => useAdminHistorySectionPage({
      loadMoreContext: {
        currentOnly: false,
        query: "",
        statusFilter: "all",
      },
      section: {
        groupKey: "open",
        items: [item("first")],
        nextCursor: "next",
        totalCount: 2,
      },
    }));

    await act(() => result.current.loadMore());

    expect(result.current.items.map((entry) => entry.id)).toEqual([
      "first",
      "second",
    ]);
    expect(result.current.nextCursor).toBeNull();
  });

  it("화면을 닫으면 진행 중 요청을 취소한다", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(loadAdminHistoryNextPage).mockImplementation(
      (_request, requestSignal) => {
        signal = requestSignal;
        return new Promise(() => undefined);
      },
    );
    const { result, unmount } = renderHook(() => useAdminHistorySectionPage({
      loadMoreContext: {
        currentOnly: false,
        query: "",
        statusFilter: "all",
      },
      section: {
        groupKey: "open",
        items: [item("first")],
        nextCursor: "next",
        totalCount: 2,
      },
    }));

    act(() => void result.current.loadMore());
    await waitFor(() => expect(result.current.loading).toBe(true));
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("21건을 10건, 10건, 1건으로 끝까지 연결한다", async () => {
    vi.mocked(loadAdminHistoryNextPage)
      .mockResolvedValueOnce({
        items: Array.from({ length: 10 }, (_, index) => item(`item-${index + 11}`)),
        nextCursor: "page-3",
      })
      .mockResolvedValueOnce({
        items: [item("item-21")],
        nextCursor: null,
      });
    const { result } = renderHook(() => useAdminHistorySectionPage({
      loadMoreContext: {
        currentOnly: false,
        query: "",
        statusFilter: "all",
      },
      section: {
        groupKey: "open",
        items: Array.from(
          { length: 10 },
          (_, index) => item(`item-${index + 1}`),
        ),
        nextCursor: "page-2",
        totalCount: 21,
      },
    }));

    await act(() => result.current.loadMore());
    expect(result.current.items).toHaveLength(20);
    expect(result.current.nextCursor).toBe("page-3");

    await act(() => result.current.loadMore());
    expect(result.current.items).toHaveLength(21);
    expect(new Set(result.current.items.map((entry) => entry.id)).size).toBe(21);
    expect(result.current.nextCursor).toBeNull();
    expect(vi.mocked(loadAdminHistoryNextPage).mock.calls.map(
      ([request]) => request.cursor,
    )).toEqual(["page-2", "page-3"]);
  });

  it("현재 응시 숨김은 이전 응시가 이동할 수 있는 구역도 서버 개수로 교체한다", async () => {
    vi.mocked(loadAdminHistoryFreshSection).mockResolvedValue({
      groupKey: "open",
      items: [item("revealed-previous")],
      nextCursor: null,
      totalCount: 7,
      version: "2026-08-31T00:00:02.000Z",
    });
    const { result } = renderHook(() => useAdminHistorySectionPage({
      loadMoreContext: {
        currentOnly: true,
        query: "",
        statusFilter: "all",
      },
      section: {
        groupKey: "open",
        items: [item("old-open")],
        nextCursor: "old-cursor",
        totalCount: 9,
        version: "2026-08-31T00:00:00.000Z",
      },
    }));

    act(() => window.dispatchEvent(new CustomEvent("admin-history:mutated", {
      detail: hiddenNotice("2026-08-31T00:00:02.000Z"),
    })));
    await waitFor(() => expect(result.current.items[0]?.id).toBe(
      "revealed-previous",
    ));
    expect(result.current.totalCount).toBe(7);
    expect(result.current.nextCursor).toBeNull();

    act(() => window.dispatchEvent(new CustomEvent("admin-history:mutated", {
      detail: hiddenNotice("2026-08-31T00:00:01.000Z"),
    })));
    await waitFor(() => expect(loadAdminHistoryFreshSection).toHaveBeenCalledTimes(2));
  });

  it("변경 후 새 목록을 못 불러오면 이전 스냅샷 커서를 다시 쓰지 않는다", async () => {
    vi.mocked(loadAdminHistoryFreshSection).mockRejectedValue(
      new Error("새 목록 실패"),
    );
    const { result } = renderHook(() => useAdminHistorySectionPage({
      loadMoreContext: {
        currentOnly: true,
        query: "",
        statusFilter: "all",
      },
      section: {
        groupKey: "completed",
        items: [item("old")],
        nextCursor: "stale-cursor",
        totalCount: 11,
      },
    }));

    act(() => window.dispatchEvent(new CustomEvent("admin-history:mutated", {
      detail: hiddenNotice("2026-08-31T00:00:03.000Z"),
    })));
    await waitFor(() => expect(result.current.failure).toBe("unavailable"));
    expect(result.current.nextCursor).toBeNull();

    await act(() => result.current.loadMore());
    expect(loadAdminHistoryNextPage).not.toHaveBeenCalled();
  });
});
