// @vitest-environment jsdom
import { useCallback, useState } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { loadStudentMistakes, WrongWordRequestError } from "../api/wrong-word-transport";
import type { AdminMistakePage, AdminMistakePageView, MistakeFilters } from "../contracts/mistake-episode";
import { useStudentMistakeHistory } from "./use-student-mistake-history";
import { fakeMistakePage, mistakeTestFilters as filters } from "./mistake-test-fixtures";
vi.mock("../api/wrong-word-transport", async original => ({ ...await original<typeof import("../api/wrong-word-transport")>(), loadStudentMistakes: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function useHost(input: { studentId: string; filters: MistakeFilters }) {
  const [cache, setCache] = useState<{ studentId: string; value: AdminMistakePageView; at: number } | null>(null);
  const onLoaded = useCallback((studentId: string, value: AdminMistakePageView | null) => {
    if (studentId === input.studentId) setCache(value ? { studentId, value, at: Date.now() } : null);
  }, [input.studentId]);
  const current = cache?.studentId === input.studentId ? cache : null;
  return useStudentMistakeHistory({ ...input, active: true, cachedAt: current?.at ?? null, cachedHistory: current?.value ?? null, onLoaded, loadErrorMessage: "불러오기 실패" });
}
it("더보기는 같은 조회판만 합치고 전체 수와 첫 요약을 유지한다", async () => {
  vi.mocked(loadStudentMistakes).mockResolvedValueOnce(fakeMistakePage()).mockResolvedValueOnce({ ...fakeMistakePage(2), nextCursor: null, summary: null, totalCount: null, datasetOptions: null, reviewDrafts: null });
  const { result } = renderHook(useHost, { initialProps: { studentId: "a", filters } });
  await waitFor(() => expect(result.current.history?.items).toHaveLength(1));
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.history?.items).toHaveLength(2));
  expect(result.current.history?.totalCount).toBe(2);
  expect(result.current.history?.summary.currentWrongCount).toBe(2);
});
it.each(["409", "version", "source"] as const)("%s 변경이면 옛 커서를 버리고 첫 페이지에서 다시 시작한다", async kind => {
  const mock = vi.mocked(loadStudentMistakes).mockResolvedValueOnce(fakeMistakePage());
  if (kind === "409") mock.mockRejectedValueOnce(new WrongWordRequestError("변경됨", 409));
  else mock.mockResolvedValueOnce({ ...fakeMistakePage(2), [kind === "version" ? "stateVersion" : "sourceVersion"]: kind === "version" ? "2" : "b".repeat(64) });
  mock.mockResolvedValueOnce({ ...fakeMistakePage(3), nextCursor: null, stateVersion: "2" });
  const { result } = renderHook(useHost, { initialProps: { studentId: "a", filters } });
  await waitFor(() => expect(result.current.history?.items[0].key).toBe("word:1"));
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.history?.items[0].key).toBe("word:3"));
  expect(result.current.history?.items).toHaveLength(1);
  expect(loadStudentMistakes).toHaveBeenLastCalledWith("a", expect.any(AbortSignal), filters, null);
});
it("자동 복구도 다시 409면 멈추고 실패를 빈 목록으로 표시하지 않는다", async () => {
  vi.mocked(loadStudentMistakes).mockRejectedValue(new WrongWordRequestError("계속 변경됨", 409));
  const { result } = renderHook(useHost, { initialProps: { studentId: "a", filters } });
  await waitFor(() => expect(result.current.error).toBe("계속 변경됨"));
  expect(loadStudentMistakes).toHaveBeenCalledTimes(2);
  expect(result.current.history).toBeNull(); expect(result.current.invalidated).toBe(true);
});
it("학생 전환과 명시적 권한 잠금은 늦게 도착한 개인 목록을 복원하지 않는다", async () => {
  let done!: (page: AdminMistakePage) => void;
  vi.mocked(loadStudentMistakes).mockImplementationOnce(() => new Promise(resolve => { done = resolve; })).mockResolvedValueOnce(fakeMistakePage(2));
  const { result, rerender } = renderHook(useHost, { initialProps: { studentId: "a", filters } });
  await waitFor(() => expect(loadStudentMistakes).toHaveBeenCalledTimes(1));
  rerender({ studentId: "b", filters });
  await waitFor(() => expect(result.current.history?.items[0].key).toBe("word:2"));
  act(() => result.current.lock());
  await act(async () => done(fakeMistakePage(1)));
  expect(result.current.locked).toBe(true); expect(result.current.history).toBeNull();
});
