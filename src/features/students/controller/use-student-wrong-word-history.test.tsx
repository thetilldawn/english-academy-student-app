// @vitest-environment jsdom
import { useCallback, useState } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WrongWordPage, WrongWordPageFilters, WrongWordPageView } from "../contracts/wrong-word-page";
import { loadStudentWrongWords, WrongWordRequestError } from "../api/wrong-word-transport";
import { useStudentWrongWordHistory } from "./use-student-wrong-word-history";
vi.mock("../api/wrong-word-transport", async importOriginal => ({
  ...await importOriginal<typeof import("../api/wrong-word-transport")>(), loadStudentWrongWords: vi.fn(),
}));
const filters: WrongWordPageFilters = { datasetId: "", level: "all", query: "" };
const summary = { wrongEventCount: 25, uniqueWordCount: 24, onceWrongWordCount: 23, repeatedWrongWordCount: 1, pendingReviewCount: 0 };
const item = (key: string): WrongWordPage["items"][number] => ({
  key, canonicalDictionaryId: key, canonicalLexemeId: null, headword: key, primaryMeaning: "검사 뜻",
  wrongCount: 1, wrongLevel: 1, lastWrongAt: "2026-09-21T00:00:00Z", latestAttemptId: "attempt",
  latestQuestionId: key, latestDatasetId: "dataset", latestVocabEntryId: 1, latestOutcome: "retry_unanswered",
  resolution: "unresolved", scheduling: "available", activeAssignment: null, occurrences: [],
});
const page = (prefix = "first", nextCursor: string | null = "next"): WrongWordPage => ({
  items: Array.from({ length: 10 }, (_, n) => item(prefix + n)), summary, totalCount: 24,
  nextCursor, datasetOptions: [], reviewDrafts: [],
});
function useHost(input: { studentId: string; active: boolean; filters: WrongWordPageFilters }) {
  const [entry, setEntry] = useState<{studentId:string; view:WrongWordPageView;at:number}|null>(null);
  const onLoaded = useCallback((id:string,view:WrongWordPageView|null) => {
    if(id===input.studentId) setEntry(view?{studentId:id,view,at:Date.now()}:null);
  }, [input.studentId]);
  const current = entry?.studentId===input.studentId?entry:null;
  return useStudentWrongWordHistory({ ...input, cachedAt:current?.at??null, cachedHistory:current?.view??null, onLoaded, loadErrorMessage:"불러오기 실패" });
}
afterEach(() => vi.clearAllMocks());
describe("on-demand wrong word history", () => {
  it("does not resurrect a failed refresh cursor after another filter also fails", async () => {
    let resolve!: (value: WrongWordPage) => void;
    vi.mocked(loadStudentWrongWords).mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error("A 갱신 실패"))
      .mockRejectedValueOnce(new Error("B 조회 실패")).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(useHost, { initialProps: { studentId: "a", active: true, filters } });
    await waitFor(() => expect(result.current.history?.items).toHaveLength(10));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBe("A 갱신 실패"));
    rerender({ studentId: "a", active: true, filters: { ...filters, level: "repeated" } });
    await waitFor(() => expect(result.current.error).toBe("B 조회 실패"));
    rerender({ studentId: "a", active: true, filters });
    await waitFor(() => expect(loadStudentWrongWords).toHaveBeenCalledTimes(4));
    expect(loadStudentWrongWords).toHaveBeenLastCalledWith("a", expect.any(AbortSignal), filters, null);
    expect(result.current.canLoadMore).toBe(false);
    await act(async () => resolve(page("fresh", "fresh-cursor")));
    await waitFor(() => expect(result.current.history?.items[0].key).toBe("fresh0"));
    expect(result.current.canLoadMore).toBe(true);
  });
  it("restores a fresh filter cache after aborting another filter", async () => {
    let resolve!: (value: WrongWordPage) => void;
    vi.mocked(loadStudentWrongWords).mockResolvedValueOnce(page()).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(useHost, { initialProps: { studentId: "a", active: true, filters } });
    await waitFor(() => expect(result.current.history?.items).toHaveLength(10));
    rerender({ studentId: "a", active: true, filters: { ...filters, level: "repeated" } });
    await waitFor(() => expect(loadStudentWrongWords).toHaveBeenCalledTimes(2));
    expect(result.current.loading).toBe(true);
    rerender({ studentId: "a", active: true, filters });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.invalidated).toBe(false);
    expect(result.current.canLoadMore).toBe(true);
    await act(async () => resolve(page("old-filter")));
    expect(result.current.history?.items[0].key).toBe("first0");
  });
  it("does not read when collapsed, then loads ten and appends the next page without changing full counts", async () => {
    vi.mocked(loadStudentWrongWords).mockResolvedValueOnce(page()).mockResolvedValueOnce({...page("second",null),summary:null,totalCount:null,datasetOptions:null,reviewDrafts:null});
    const {result,rerender}=renderHook(useHost,{initialProps:{studentId:"a",active:false,filters}});
    expect(loadStudentWrongWords).not.toHaveBeenCalled();
    rerender({studentId:"a",active:true,filters});
    await waitFor(()=>expect(result.current.history?.items).toHaveLength(10));
    act(()=>result.current.loadMore());
    await waitFor(()=>expect(result.current.history?.items).toHaveLength(20));
    expect(loadStudentWrongWords).toHaveBeenNthCalledWith(2,"a",expect.any(AbortSignal),filters,"next");
    expect(result.current.history?.summary).toEqual(summary);
    expect(result.current.history?.totalCount).toBe(24);
    expect(result.current.canLoadMore).toBe(false);
    rerender({studentId:"a",active:false,filters}); rerender({studentId:"a",active:true,filters});
    expect(loadStudentWrongWords).toHaveBeenCalledTimes(2);
  });
  it("discards late student responses and cancels hidden requests", async () => {
    const pending:Array<{signal:AbortSignal;resolve:(page:WrongWordPage)=>void}>=[];
    vi.mocked(loadStudentWrongWords).mockImplementation((_id,signal)=>new Promise(resolve=>pending.push({signal,resolve})));
    const {result,rerender}=renderHook(useHost,{initialProps:{studentId:"a",active:true,filters}});
    await waitFor(()=>expect(pending).toHaveLength(1));
    rerender({studentId:"b",active:true,filters});
    await waitFor(()=>expect(pending).toHaveLength(2));
    expect(pending[0].signal.aborted).toBe(true);
    await act(async()=>pending[0].resolve(page("old")));
    expect(result.current.history).toBeNull();
    await act(async()=>pending[1].resolve(page("new")));
    await waitFor(()=>expect(result.current.history?.items[0].key).toBe("new0"));
  });
  it("preserves loaded words after more fails and retries only on request", async () => {
    vi.mocked(loadStudentWrongWords).mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error("더보기 실패")).mockResolvedValueOnce({...page("second",null),summary:null,totalCount:null,datasetOptions:null,reviewDrafts:null});
    const {result}=renderHook(useHost,{initialProps:{studentId:"a",active:true,filters}});
    await waitFor(()=>expect(result.current.history?.items).toHaveLength(10));
    act(()=>result.current.loadMore());
    await waitFor(()=>expect(result.current.error).toBe("더보기 실패"));
    expect(result.current.history?.items).toHaveLength(10); expect(result.current.canLoadMore).toBe(true);
    expect(loadStudentWrongWords).toHaveBeenCalledTimes(2);
    act(()=>result.current.loadMore());
    await waitFor(()=>expect(result.current.history?.items).toHaveLength(20));
  });
  it("invalidates the old cursor on failed refresh and restarts filters on their first page", async () => {
    vi.mocked(loadStudentWrongWords).mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error("갱신 실패")).mockResolvedValueOnce(page("filtered",null));
    const {result,rerender}=renderHook(useHost,{initialProps:{studentId:"a",active:true,filters}});
    await waitFor(()=>expect(result.current.history?.items).toHaveLength(10));
    act(()=>result.current.refresh());
    await waitFor(()=>expect(result.current.error).toBe("갱신 실패"));
    expect(result.current.canLoadMore).toBe(false);
    act(()=>result.current.loadMore()); expect(loadStudentWrongWords).toHaveBeenCalledTimes(2);
    const next={...filters,level:"repeated" as const};
    rerender({studentId:"a",active:true,filters:next});
    expect(result.current.history).toBeNull();
    await waitFor(()=>expect(result.current.history?.items[0].key).toBe("filtered0"));
    expect(loadStudentWrongWords).toHaveBeenLastCalledWith("a",expect.any(AbortSignal),next,null);
  });
  it("clears personal history on a permission rejection during pagination", async () => {
    vi.mocked(loadStudentWrongWords).mockResolvedValueOnce(page()).mockRejectedValueOnce(new WrongWordRequestError("권한 없음",403));
    const {result}=renderHook(useHost,{initialProps:{studentId:"a",active:true,filters}});
    await waitFor(()=>expect(result.current.history?.items).toHaveLength(10));
    act(()=>result.current.loadMore());
    await waitFor(()=>expect(result.current.locked).toBe(true));
    expect(result.current.history).toBeNull(); expect(result.current.canLoadMore).toBe(false);
  });
});
