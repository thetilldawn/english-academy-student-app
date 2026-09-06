// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { emptyStudentDirectoryFilters, type StudentDirectorySnapshot } from "@/features/students/public-contracts";
import { loadStudentDirectoryNextPage, loadStudentDirectorySnapshot } from "@/features/students/public-client";
import { useAssignmentStudentDirectory } from "./use-assignment-student-directory";
vi.mock("@/features/students/public-client", () => ({ loadStudentDirectoryNextPage: vi.fn(), loadStudentDirectorySnapshot: vi.fn(), useStudentDirectoryCache: () => null }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function snapshot(query = "", cursor: string | null = null): StudentDirectorySnapshot {
  return { filters: { ...emptyStudentDirectoryFilters, query }, filterOptions: { classGroups: [], grades: [], schools: [], wordbooks: [] }, page: { items: [], nextCursor: cursor }, totalCount: 0, snapshotAt: query || "initial" };
}
it("같은 정규화조건의 성공/진행중 요청을 합치고 실제 다른 조건은 읽는다", async () => {
  let resolve!: (value: StudentDirectorySnapshot) => void;
  let signal: AbortSignal | undefined;
  vi.mocked(loadStudentDirectorySnapshot).mockImplementation((_request, incoming) => { signal = incoming; return new Promise((done) => { resolve = done; }); });
  const { result } = renderHook(() => useAssignmentStudentDirectory(snapshot()));
  act(() => result.current.actions.replaceFilters({ ...emptyStudentDirectoryFilters, query: "  " }));
  expect(loadStudentDirectorySnapshot).not.toHaveBeenCalled();
  act(() => result.current.actions.replaceFilters({ ...emptyStudentDirectoryFilters, query: "가람" }));
  await waitFor(() => expect(loadStudentDirectorySnapshot).toHaveBeenCalledOnce());
  act(() => result.current.actions.replaceFilters({ ...emptyStudentDirectoryFilters, query: "  가람  " }));
  expect(signal?.aborted).toBe(false); expect(loadStudentDirectorySnapshot).toHaveBeenCalledOnce();
  await act(async () => resolve(snapshot("가람")));
  act(() => result.current.actions.replaceFilters({ ...emptyStudentDirectoryFilters, query: "가람" }));
  expect(loadStudentDirectorySnapshot).toHaveBeenCalledOnce();
});
it("저장후 강제갱신은 같은조건도 다시 읽고 실패한 스냅샷의 커서를 버린다", async () => {
  vi.mocked(loadStudentDirectorySnapshot).mockRejectedValueOnce(new Error("실패")).mockResolvedValueOnce(snapshot("", "new-cursor"));
  const { result } = renderHook(() => useAssignmentStudentDirectory(snapshot("", "old-cursor")));
  await act(() => result.current.actions.reloadFirstPage());
  expect(result.current.snapshot.page.nextCursor).toBeNull();
  await act(() => result.current.actions.loadMore()); expect(loadStudentDirectoryNextPage).not.toHaveBeenCalled();
  await act(() => result.current.actions.reloadFirstPage());
  expect(result.current.snapshot.page.nextCursor).toBe("new-cursor");
  expect(loadStudentDirectorySnapshot).toHaveBeenCalledTimes(2);
});
it("실패한 검색을 정상캐시로 삼지 않고 같은 검색을 다시 할 수 있다", async () => {
  vi.mocked(loadStudentDirectorySnapshot).mockRejectedValueOnce(new Error("실패")).mockResolvedValueOnce(snapshot("가람"));
  const { result } = renderHook(() => useAssignmentStudentDirectory(snapshot()));
  act(() => result.current.actions.replaceFilters({ ...emptyStudentDirectoryFilters, query: "가람" }));
  await waitFor(() => expect(result.current.error).toBe("실패"));
  act(() => result.current.actions.replaceFilters({ ...emptyStudentDirectoryFilters, query: "가람" }));
  await waitFor(() => expect(result.current.snapshot.filters.query).toBe("가람"));
  expect(loadStudentDirectorySnapshot).toHaveBeenCalledTimes(2);
});
it("새 검색이 시작되면 이전 요청을 취소하고 늦은 응답을 버린다", async () => {
  const requests: { signal?: AbortSignal; resolve(value: StudentDirectorySnapshot): void }[] = [];
  vi.mocked(loadStudentDirectorySnapshot).mockImplementation((_request, signal) => new Promise((resolve) => requests.push({ signal, resolve })));
  const { result } = renderHook(() => useAssignmentStudentDirectory(snapshot()));
  act(() => result.current.actions.replaceFilters({ ...emptyStudentDirectoryFilters, query: "가" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  act(() => result.current.actions.replaceFilters({ ...emptyStudentDirectoryFilters, query: "가람" }));
  await waitFor(() => expect(requests).toHaveLength(2)); expect(requests[0].signal?.aborted).toBe(true);
  await act(async () => requests[0].resolve(snapshot("가"))); expect(result.current.snapshot.filters.query).toBe("");
  await act(async () => requests[1].resolve(snapshot("가람"))); expect(result.current.snapshot.filters.query).toBe("가람");
});
