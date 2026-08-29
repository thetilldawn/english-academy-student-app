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
});
