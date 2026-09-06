// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AssignmentWorkspaceReadError, loadAssignmentDatasetDirectory } from "@/features/assignments/public-client";
import { useStudentCreatePreparation } from "./use-student-create-preparation";
vi.mock("@/features/assignments/public-client", async (original) => ({
  ...await original<typeof import("@/features/assignments/public-client")>(), loadAssignmentDatasetDirectory: vi.fn(),
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("닫힘0·첫열기1·정상 빈목록도 성공 재열기 추가0", async () => {
  vi.mocked(loadAssignmentDatasetDirectory).mockResolvedValue({ datasets: [] });
  const { result } = renderHook(useStudentCreatePreparation);
  expect(loadAssignmentDatasetDirectory).not.toHaveBeenCalled();
  act(() => result.current.actions.changeOpen(true));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  act(() => { result.current.actions.changeOpen(false); result.current.actions.changeOpen(true); });
  expect(loadAssignmentDatasetDirectory).toHaveBeenCalledOnce();
  expect(result.current.datasets).toEqual([]);
});
it("중복 열기는 합치고 취소 뒤 재열기 요청과 늦은 성공을 구분한다", async () => {
  const requests: { signal?: AbortSignal; resolve(value: { datasets: [] }): void }[] = [];
  vi.mocked(loadAssignmentDatasetDirectory).mockImplementation((signal) => new Promise((resolve) => requests.push({ signal, resolve })));
  const { result, unmount } = renderHook(useStudentCreatePreparation);
  act(() => { result.current.actions.changeOpen(true); result.current.actions.changeOpen(true); });
  expect(requests).toHaveLength(1);
  act(() => result.current.actions.changeOpen(false));
  expect(requests[0].signal?.aborted).toBe(true); expect(result.current.status).toBe("idle");
  act(() => result.current.actions.changeOpen(true)); expect(requests).toHaveLength(2);
  await act(async () => requests[0].resolve({ datasets: [] }));
  expect(result.current.status).toBe("loading");
  unmount(); expect(requests[1].signal?.aborted).toBe(true);
  await act(async () => requests[1].resolve({ datasets: [] }));
});
it("실패는 빈목록이 아니며 재열기로 반복하지 않고 명시 재시도한다", async () => {
  vi.mocked(loadAssignmentDatasetDirectory).mockRejectedValueOnce(new Error("private SQL secret")).mockResolvedValueOnce({ datasets: [] });
  const { result } = renderHook(useStudentCreatePreparation);
  act(() => result.current.actions.changeOpen(true));
  await waitFor(() => expect(result.current.status).toBe("error"));
  act(() => { result.current.actions.changeOpen(false); result.current.actions.changeOpen(true); });
  expect(loadAssignmentDatasetDirectory).toHaveBeenCalledOnce();
  act(() => result.current.actions.retry());
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(loadAssignmentDatasetDirectory).toHaveBeenCalledTimes(2);
});
it.each([401, 403])("%s 거절은 자료가 없는 상태와 다르다", async (status) => {
  vi.mocked(loadAssignmentDatasetDirectory).mockRejectedValue(new AssignmentWorkspaceReadError(status, "server internal"));
  const { result } = renderHook(useStudentCreatePreparation);
  act(() => result.current.actions.changeOpen(true));
  await waitFor(() => expect(result.current.status).toBe("auth-error"));
  expect(result.current.datasets).toEqual([]);
});
it("취소된 이전 실패가 새 성공을 덮어쓰지 않는다", async () => {
  let rejectOld!: (error: Error) => void;
  vi.mocked(loadAssignmentDatasetDirectory).mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
    .mockResolvedValueOnce({ datasets: [] });
  const { result } = renderHook(useStudentCreatePreparation);
  act(() => result.current.actions.changeOpen(true));
  act(() => result.current.actions.changeOpen(false));
  act(() => result.current.actions.changeOpen(true));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  await act(async () => rejectOld(new AssignmentWorkspaceReadError(401, "expired")));
  expect(result.current.status).toBe("ready");
});
