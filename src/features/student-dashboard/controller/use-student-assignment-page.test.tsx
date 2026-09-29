// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StudentAssignmentSummary } from "@/features/student-dashboard/contracts/student-dashboard-read-model";
import { loadStudentDashboardSectionPage } from "@/features/student-dashboard/transport/student-dashboard-pages";
import { StudentDashboardRequestError } from "../contracts/student-dashboard-request-error";

import { useStudentAssignmentPage } from "./use-student-assignment-page";

function useStudentCurrentPage(page: Parameters<typeof useStudentAssignmentPage>[0]) { return useStudentAssignmentPage(page, "current"); }
const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("@/components/document-navigation", () => ({ navigateDocument: navigation.replace }));

vi.mock("@/features/student-dashboard/transport/student-dashboard-pages", () => ({
  loadStudentDashboardSectionPage: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

function assignment(id: string) {
  return { id } as StudentAssignmentSummary;
}

describe("student completed assignments controller", () => {
  it("21건을 10건, 10건, 1건으로 중복 없이 연결한다", async () => {
    vi.mocked(loadStudentDashboardSectionPage)
      .mockResolvedValueOnce({
        items: Array.from({ length: 10 }, (_, index) =>
          assignment(`item-${index + 11}`)),
        nextCursor: "page-3",
      })
      .mockResolvedValueOnce({
        items: [assignment("item-21")],
        nextCursor: null,
      });
    const { result } = renderHook(() => useStudentCurrentPage({
      items: Array.from({ length: 10 }, (_, index) =>
        assignment(`item-${index + 1}`)),
      nextCursor: "page-2",
    }));

    await act(() => result.current.loadMore());
    await act(() => result.current.loadMore());

    expect(result.current.items).toHaveLength(21);
    expect(new Set(result.current.items.map((item) => item.id)).size).toBe(21);
    expect(result.current.nextCursor).toBeNull();
    expect(vi.mocked(loadStudentDashboardSectionPage).mock.calls.map(
      ([cursor]) => cursor,
    )).toEqual(["page-2", "page-3"]);
  });

  it("중복 클릭을 막고 화면을 닫으면 진행 요청을 취소한다", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(loadStudentDashboardSectionPage).mockImplementation(
      (_cursor, requestSignal) => {
        signal = requestSignal;
        return new Promise(() => undefined);
      },
    );
    const { result, unmount } = renderHook(() =>
      useStudentCurrentPage({
        items: [assignment("first")],
        nextCursor: "page-2",
      })
    );

    act(() => {
      void result.current.loadMore();
      void result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(loadStudentDashboardSectionPage).toHaveBeenCalledTimes(1);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("실패 뒤 같은 커서로 다시 시도할 수 있다", async () => {
    vi.mocked(loadStudentDashboardSectionPage)
      .mockRejectedValueOnce(new Error("연결 실패"))
      .mockResolvedValueOnce({ items: [assignment("second")], nextCursor: null });
    const { result } = renderHook(() => useStudentCurrentPage({
      items: [assignment("first")],
      nextCursor: "page-2",
    }));

    await act(() => result.current.loadMore());
    expect(result.current.error).toBe("다음 시험 목록을 불러오지 못했습니다. 다시 시도해 주세요.");
    await act(() => result.current.loadMore());
    expect(result.current.items.map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it.each([401, 403])("실제 %s에는 기존 개인 내역·커서를 지우고 접속 화면으로 이동한다", async (status) => {
    vi.mocked(loadStudentDashboardSectionPage).mockRejectedValueOnce(new StudentDashboardRequestError(status));
    const { result } = renderHook(() => useStudentCurrentPage({ items: [assignment("private")], nextCursor: "private-cursor" }));
    await act(() => result.current.loadMore());
    expect(result.current).toMatchObject({ items: [], nextCursor: null, navigationRequired: true, loading: false });
    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith("/", true);
    await act(() => result.current.loadMore());
    expect(loadStudentDashboardSectionPage).toHaveBeenCalledOnce();
  });

  it("503은 로그인 만료가 아니며 같은 목록·커서로 복구한다", async () => {
    vi.mocked(loadStudentDashboardSectionPage)
      .mockRejectedValueOnce(new StudentDashboardRequestError(503))
      .mockResolvedValueOnce({ items: [assignment("next")], nextCursor: null });
    const { result } = renderHook(() => useStudentCurrentPage({ items: [assignment("first")], nextCursor: "cursor" }));
    await act(() => result.current.loadMore());
    expect(result.current).toMatchObject({ items: [assignment("first")], nextCursor: "cursor", navigationRequired: false });
    expect(navigation.replace).not.toHaveBeenCalled();
    await act(() => result.current.loadMore());
    expect(result.current.error).toBe("");
    expect(result.current.items).toEqual([assignment("first"), assignment("next")]);
  });

  it("옛 화면을 닫은 뒤 늦게 온 응답은 새 학생 화면에 섞이지 않는다", async () => {
    let resolve!: (page: { items: StudentAssignmentSummary[]; nextCursor: null }) => void;
    vi.mocked(loadStudentDashboardSectionPage).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const old = renderHook(() => useStudentCurrentPage({ items: [assignment("old")], nextCursor: "old-cursor" }));
    let request!: Promise<void>;
    act(() => { request = old.result.current.loadMore(); });
    old.unmount();
    const current = renderHook(() => useStudentCurrentPage({ items: [assignment("new")], nextCursor: null }));
    await act(async () => { resolve({ items: [assignment("late-private")], nextCursor: null }); await request; });
    expect(current.result.current.items).toEqual([assignment("new")]);
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("같은 화면에서 학생이 바뀌어409를 받으면 옛 카드와커서를 버리고 새 문서로 이동한다", async () => {
    vi.mocked(loadStudentDashboardSectionPage).mockRejectedValueOnce(new StudentDashboardRequestError(409));
    const { result } = renderHook(() => useStudentCurrentPage({ items: [assignment("student-a-private")], nextCursor: "student-a-cursor" }));
    await act(() => result.current.loadMore());
    expect(result.current).toMatchObject({ items: [], nextCursor: null, navigationRequired: true });
    expect(result.current.error).toContain("접속한 학생이 바뀌었습니다.");
    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith("/student", true);
  });
});
