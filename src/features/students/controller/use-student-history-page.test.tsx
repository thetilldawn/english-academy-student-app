// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminHistoryListItem } from "@/features/history/contracts/admin-history-read-model";

import { emptyStudentHistoryFilters } from "../contracts/student-detail-read-model";
import {
  loadStudentHistoryInitial,
  loadStudentHistoryNextPage,
} from "../transport/student-history-pages";
import { useStudentHistoryPage } from "./use-student-history-page";

vi.mock("../transport/student-history-pages", () => ({
  loadStudentHistoryInitial: vi.fn(),
  loadStudentHistoryNextPage: vi.fn(),
}));

function item(id: string) {
  return { id } as AdminHistoryListItem;
}

afterEach(() => vi.clearAllMocks());

describe("useStudentHistoryPage", () => {
  it("accumulates 29 records as 10, 20, then 29", async () => {
    vi.mocked(loadStudentHistoryNextPage)
      .mockResolvedValueOnce({
        items: Array.from({ length: 10 }, (_, index) => item(String(index + 11))),
        nextCursor: "third",
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 9 }, (_, index) => item(String(index + 21))),
        nextCursor: null,
      });
    const { result } = renderHook(() => useStudentHistoryPage({
      initialPage: {
        items: Array.from({ length: 10 }, (_, index) => item(String(index + 1))),
        nextCursor: "second",
        totalCount: 29,
      },
      studentId: "00000000-0000-4000-8000-000000000001",
    }));

    expect(result.current.page.items).toHaveLength(10);
    await act(async () => result.current.actions.loadMore());
    await waitFor(() => expect(result.current.page.items).toHaveLength(20));
    expect(result.current.page.nextCursor).toBe("third");

    await act(async () => result.current.actions.loadMore());
    await waitFor(() => expect(result.current.page.items).toHaveLength(29));
    expect(new Set(result.current.page.items.map((entry) => entry.id)).size).toBe(29);
    expect(result.current.page.nextCursor).toBeNull();
    expect(result.current.page.totalCount).toBe(29);
  });

  it("appends the next 10 records without duplicates and preserves the total", async () => {
    vi.mocked(loadStudentHistoryNextPage).mockResolvedValue({
      items: [item("2"), item("3")],
      nextCursor: null,
    });
    const { result } = renderHook(() => useStudentHistoryPage({
      initialPage: {
        items: [item("1"), item("2")],
        nextCursor: "next",
        totalCount: 21,
      },
      studentId: "00000000-0000-4000-8000-000000000001",
    }));

    await act(async () => result.current.actions.loadMore());
    await waitFor(() => {
      expect(result.current.page.items.map((entry) => entry.id)).toEqual([
        "1",
        "2",
        "3",
      ]);
    });
    expect(result.current.page.totalCount).toBe(21);
    expect(result.current.page.nextCursor).toBeNull();
  });

  it("aborts an older filter request and ignores its late response", async () => {
    const requests: Array<{
      resolve: (value: { items: AdminHistoryListItem[]; nextCursor: null; totalCount: number }) => void;
      signal: AbortSignal | undefined;
    }> = [];
    vi.mocked(loadStudentHistoryInitial).mockImplementation(
      (_studentId, _request, signal) => new Promise((resolve) => {
        requests.push({ resolve, signal });
      }),
    );
    const { result } = renderHook(() => useStudentHistoryPage({
      initialPage: { items: [item("initial")], nextCursor: null, totalCount: 1 },
      studentId: "00000000-0000-4000-8000-000000000001",
    }));

    act(() => { void result.current.actions.replaceFilters({
      ...emptyStudentHistoryFilters,
      purpose: "regular",
    }); });
    await waitFor(() => expect(requests).toHaveLength(1));
    act(() => { void result.current.actions.replaceFilters({
      ...emptyStudentHistoryFilters,
      purpose: "review",
    }); });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0]?.signal?.aborted).toBe(true);

    await act(async () => {
      requests[0]?.resolve({ items: [item("old")], nextCursor: null, totalCount: 1 });
      await Promise.resolve();
    });
    expect(result.current.page.items[0]?.id).toBe("initial");

    await act(async () => {
      requests[1]?.resolve({ items: [item("new")], nextCursor: null, totalCount: 1 });
      await Promise.resolve();
    });
    expect(result.current.page.items[0]?.id).toBe("new");
    expect(result.current.filters.purpose).toBe("review");
  });

  it("첫 페이지 갱신이 필터 요청을 중단하고 진행 중에는 과거 커서를 붙이지 않는다", async () => {
    const requests: Array<{
      resolve: (value: { items: AdminHistoryListItem[]; nextCursor: null; totalCount: number }) => void;
      signal: AbortSignal | undefined;
    }> = [];
    vi.mocked(loadStudentHistoryInitial).mockImplementation(
      (_studentId, _request, signal) => new Promise((resolve) => {
        requests.push({ resolve, signal });
      }),
    );
    const { result } = renderHook(() => useStudentHistoryPage({
      initialPage: {
        items: [item("initial")],
        nextCursor: "old-cursor",
        totalCount: 11,
      },
      studentId: "00000000-0000-4000-8000-000000000001",
    }));

    act(() => void result.current.actions.replaceFilters({
      ...emptyStudentHistoryFilters,
      purpose: "regular",
    }));
    await waitFor(() => expect(result.current.filtering).toBe(true));

    act(() => void result.current.actions.refreshFirstPage());
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0]?.signal?.aborted).toBe(true);
    expect(result.current.filtering).toBe(false);

    await act(async () => result.current.actions.loadMore());
    expect(loadStudentHistoryNextPage).not.toHaveBeenCalled();

    await act(async () => {
      requests[1]?.resolve({
        items: [item("fresh")],
        nextCursor: null,
        totalCount: 1,
      });
      await Promise.resolve();
    });
    expect(result.current.page.items[0]?.id).toBe("fresh");
  });

  it("첫 페이지 갱신이 실패해도 이전 스냅샷의 더보기를 막는다", async () => {
    vi.mocked(loadStudentHistoryInitial).mockRejectedValue(
      new Error("새 목록 실패"),
    );
    const { result } = renderHook(() => useStudentHistoryPage({
      initialPage: {
        items: [item("old")],
        nextCursor: "stale-cursor",
        totalCount: 11,
      },
      studentId: "00000000-0000-4000-8000-000000000001",
    }));

    await act(async () => result.current.actions.refreshFirstPage());
    expect(result.current.error).toBe("새 목록 실패");
    expect(result.current.page.nextCursor).toBeNull();

    await act(async () => result.current.actions.loadMore());
    expect(loadStudentHistoryNextPage).not.toHaveBeenCalled();
  });
});
