// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StudentAssignmentSummary } from "@/features/student-dashboard/contracts/student-dashboard-read-model";
import { loadStudentDashboardCompletedPage } from "@/features/student-dashboard/transport/student-dashboard-pages";

import { useStudentCompletedAssignments } from "./use-student-completed-assignments";

vi.mock("@/features/student-dashboard/transport/student-dashboard-pages", () => ({
  loadStudentDashboardCompletedPage: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

function assignment(id: string) {
  return { id } as StudentAssignmentSummary;
}

describe("student completed assignments controller", () => {
  it("21건을 10건, 10건, 1건으로 중복 없이 연결한다", async () => {
    vi.mocked(loadStudentDashboardCompletedPage)
      .mockResolvedValueOnce({
        items: Array.from({ length: 10 }, (_, index) =>
          assignment(`item-${index + 11}`)),
        nextCursor: "page-3",
      })
      .mockResolvedValueOnce({
        items: [assignment("item-21")],
        nextCursor: null,
      });
    const { result } = renderHook(() => useStudentCompletedAssignments({
      items: Array.from({ length: 10 }, (_, index) =>
        assignment(`item-${index + 1}`)),
      nextCursor: "page-2",
    }));

    await act(() => result.current.loadMore());
    await act(() => result.current.loadMore());

    expect(result.current.items).toHaveLength(21);
    expect(new Set(result.current.items.map((item) => item.id)).size).toBe(21);
    expect(result.current.nextCursor).toBeNull();
    expect(vi.mocked(loadStudentDashboardCompletedPage).mock.calls.map(
      ([cursor]) => cursor,
    )).toEqual(["page-2", "page-3"]);
  });

  it("중복 클릭을 막고 화면을 닫으면 진행 요청을 취소한다", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(loadStudentDashboardCompletedPage).mockImplementation(
      (_cursor, requestSignal) => {
        signal = requestSignal;
        return new Promise(() => undefined);
      },
    );
    const { result, unmount } = renderHook(() =>
      useStudentCompletedAssignments({
        items: [assignment("first")],
        nextCursor: "page-2",
      })
    );

    act(() => {
      void result.current.loadMore();
      void result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(loadStudentDashboardCompletedPage).toHaveBeenCalledTimes(1);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("실패 뒤 같은 커서로 다시 시도할 수 있다", async () => {
    vi.mocked(loadStudentDashboardCompletedPage)
      .mockRejectedValueOnce(new Error("연결 실패"))
      .mockResolvedValueOnce({ items: [assignment("second")], nextCursor: null });
    const { result } = renderHook(() => useStudentCompletedAssignments({
      items: [assignment("first")],
      nextCursor: "page-2",
    }));

    await act(() => result.current.loadMore());
    expect(result.current.error).toBe("연결 실패");
    await act(() => result.current.loadMore());
    expect(result.current.items.map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
  });
});

