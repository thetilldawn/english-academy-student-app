// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emptyStudentDirectoryFilters,
  type StudentDirectoryListItem,
  type StudentDirectorySnapshot,
} from "../contracts/student-directory-read-model";
import {
  loadStudentDirectoryNextPage,
  loadStudentDirectorySnapshot,
} from "../transport/student-directory-pages";
import {
  announceStudentDirectoryRefresh,
  announceStudentRemoved,
} from "./student-directory-events";
import { useStudentDirectoryPage } from "./use-student-directory-page";

vi.mock("../transport/student-directory-pages", () => ({
  loadStudentDirectoryNextPage: vi.fn(),
  loadStudentDirectorySnapshot: vi.fn(),
}));

function student(index: number): StudentDirectoryListItem {
  return {
    codeStatus: "active",
    completedCount: 0,
    currentVocabBook: null,
    displayName: `학생 ${index}`,
    gradeLabel: null,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    missedCount: 0,
    notStartedCount: 0,
    rawPoints: 0,
    recentExamAt: null,
    schoolName: null,
    status: "active",
  };
}

function snapshot(input: {
  items?: StudentDirectoryListItem[];
  nextCursor?: string | null;
  query?: string;
  snapshotAt?: string;
  totalCount?: number;
} = {}): StudentDirectorySnapshot {
  const items = input.items ?? [student(1)];
  return {
    filterOptions: {
      classGroups: [],
      grades: [],
      schools: [],
      wordbooks: [],
    },
    filters: {
      ...emptyStudentDirectoryFilters,
      query: input.query ?? "",
    },
    page: {
      items,
      nextCursor: input.nextCursor ?? null,
    },
    snapshotAt: input.snapshotAt ?? "2026-08-29T00:00:00.000Z",
    totalCount: input.totalCount ?? items.length,
  };
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useStudentDirectoryPage", () => {
  it("이전 필터 요청을 취소하고 늦은 응답을 무시한다", async () => {
    const requests: Array<{
      query: string;
      resolve: (value: StudentDirectorySnapshot) => void;
      signal: AbortSignal | undefined;
    }> = [];
    vi.mocked(loadStudentDirectorySnapshot).mockImplementation(
      (request, signal) => new Promise((resolve) => {
        requests.push({ query: request.filters.query, resolve, signal });
      }),
    );
    const initialSnapshot = snapshot();
    const { result } = renderHook(() =>
      useStudentDirectoryPage(initialSnapshot)
    );

    act(() => result.current.actions.replaceFilters({
      ...emptyStudentDirectoryFilters,
      query: "가",
    }));
    await waitFor(() => expect(requests).toHaveLength(1));

    act(() => result.current.actions.replaceFilters({
      ...emptyStudentDirectoryFilters,
      query: "가람",
    }));
    expect(requests[0]?.signal?.aborted).toBe(true);
    await waitFor(() => expect(requests).toHaveLength(2));

    await act(async () => {
      requests[0]?.resolve(snapshot({ items: [student(2)], query: "가" }));
      await Promise.resolve();
    });
    expect(result.current.snapshot.filters.query).toBe("");

    await act(async () => {
      requests[1]?.resolve(snapshot({ items: [student(3)], query: "가람" }));
      await Promise.resolve();
    });
    expect(result.current.snapshot.filters.query).toBe("가람");
    expect(result.current.snapshot.page.items[0]?.id).toBe(student(3).id);
  });

  it("다음 10명을 중복 없이 현재 목록 뒤에 붙인다", async () => {
    vi.mocked(loadStudentDirectoryNextPage).mockResolvedValue({
      items: [student(2), student(3)],
      nextCursor: null,
    });
    const initialSnapshot = snapshot({
      items: [student(1), student(2)],
      nextCursor: "next-page",
    });
    const { result } = renderHook(() =>
      useStudentDirectoryPage(initialSnapshot)
    );

    await act(async () => result.current.actions.loadMore());

    await waitFor(() => {
      expect(result.current.snapshot.page.items.map((item) => item.id)).toEqual([
        student(1).id,
        student(2).id,
        student(3).id,
      ]);
    });
    expect(result.current.snapshot.page.nextCursor).toBeNull();
    expect(loadStudentDirectoryNextPage).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "next-page", mode: "page" }),
      expect.any(AbortSignal),
    );
  });

  it("현재 필터를 보존하고 첫 10+1만 최신 목록으로 다시 읽는다", async () => {
    vi.mocked(loadStudentDirectoryNextPage)
      .mockResolvedValueOnce({
        items: [student(3), student(4)],
        nextCursor: "page-3",
      })
      .mockResolvedValueOnce({
        items: [student(3), student(5)],
        nextCursor: null,
      });
    vi.mocked(loadStudentDirectorySnapshot).mockResolvedValueOnce(snapshot({
      items: [
        { ...student(1), displayName: "학생 1 수정" },
        student(2),
      ],
      nextCursor: "refresh-page-2",
      query: "고3",
      snapshotAt: "2026-08-29T01:00:00.000Z",
      totalCount: 5,
    }));
    const initialSnapshot = snapshot({
      items: [student(1), student(2)],
      nextCursor: "page-2",
      query: "고3",
      totalCount: 5,
    });
    const { result } = renderHook(() =>
      useStudentDirectoryPage(initialSnapshot)
    );

    await act(async () => result.current.actions.loadMore());
    expect(result.current.snapshot.page.items).toHaveLength(4);

    act(() => announceStudentDirectoryRefresh());

    await waitFor(() => {
      expect(loadStudentDirectorySnapshot).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(result.current.filtering).toBe(false);
      expect(result.current.snapshot.snapshotAt).toBe(
        "2026-08-29T01:00:00.000Z",
      );
    });
    expect(result.current.filters.query).toBe("고3");
    expect(result.current.snapshot.page.items.map((item) => item.id)).toEqual([
      student(1).id,
      student(2).id,
    ]);
    expect(result.current.snapshot.page.items[0]?.displayName).toBe(
      "학생 1 수정",
    );
    expect(loadStudentDirectoryNextPage).toHaveBeenCalledTimes(1);
  });

  it("삭제된 학생을 늦은 더보기 응답이 다시 넣지 못하게 한다", async () => {
    let resolvePage:
      | ((value: { items: StudentDirectoryListItem[]; nextCursor: null }) => void)
      | undefined;
    let requestSignal: AbortSignal | undefined;
    vi.mocked(loadStudentDirectoryNextPage).mockImplementation(
      (_request, signal) => new Promise((resolve) => {
        requestSignal = signal;
        resolvePage = resolve;
      }),
    );
    vi.mocked(loadStudentDirectorySnapshot).mockResolvedValueOnce(snapshot({
      items: [student(2), student(3)],
      totalCount: 2,
    }));
    const { result } = renderHook(() => useStudentDirectoryPage(snapshot({
      items: [student(1), student(2)],
      nextCursor: "page-2",
      totalCount: 3,
    })));

    act(() => { void result.current.actions.loadMore(); });
    await waitFor(() => expect(result.current.loadingMore).toBe(true));
    act(() => announceStudentRemoved(student(1).id));
    expect(requestSignal?.aborted).toBe(true);
    await waitFor(() => {
      expect(loadStudentDirectorySnapshot).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(result.current.filtering).toBe(false);
      expect(result.current.snapshot.page.items.map((item) => item.id)).toEqual([
        student(2).id,
        student(3).id,
      ]);
    });

    await act(async () => {
      resolvePage?.({ items: [student(1), student(3)], nextCursor: null });
      await Promise.resolve();
    });
    expect(result.current.snapshot.page.items.map((item) => item.id)).toEqual([
      student(2).id,
      student(3).id,
    ]);
    expect(result.current.loadingMore).toBe(false);
  });

  it("필터 실패 시 적용된 조건으로 되돌리고 더보기를 다시 허용한다", async () => {
    vi.mocked(loadStudentDirectorySnapshot).mockRejectedValueOnce(
      new Error("필터 실패"),
    );
    vi.mocked(loadStudentDirectoryNextPage).mockResolvedValueOnce({
      items: [student(2)],
      nextCursor: null,
    });
    const { result } = renderHook(() => useStudentDirectoryPage(snapshot({
      items: [student(1)],
      nextCursor: "page-2",
      query: "기존",
      totalCount: 2,
    })));

    act(() => result.current.actions.replaceFilters({
      ...emptyStudentDirectoryFilters,
      query: "새 조건",
    }));
    await waitFor(() => expect(result.current.error).toBe("필터 실패"));
    expect(result.current.filters.query).toBe("기존");

    await act(async () => result.current.actions.loadMore());
    expect(loadStudentDirectoryNextPage).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ query: "기존" }),
      }),
      expect.any(AbortSignal),
    );
    expect(result.current.snapshot.page.items).toHaveLength(2);
  });
});
