// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminHistoryListItem } from "@/features/history/contracts/admin-history-read-model";
import { loadAdminHistoryNextPage } from "@/features/history/transport/history-pages";

import { useAdminHistorySectionPage } from "./use-admin-history-section-page";

vi.mock("@/features/history/transport/history-pages", () => ({
  loadAdminHistoryNextPage: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function item(id: string) {
  return { id } as AdminHistoryListItem;
}

describe("admin history section page controller", () => {
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
});
