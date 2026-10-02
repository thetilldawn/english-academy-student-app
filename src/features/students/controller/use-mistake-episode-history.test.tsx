/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({load:vi.fn()}));
vi.mock("../transport/mistake-episode-history",async()=>({...await vi.importActual("../transport/mistake-episode-history"),loadMistakeEpisodeHistory:mocks.load}));
import { MistakeEpisodeHistoryError } from "../transport/mistake-episode-history";
import { useMistakeEpisodeHistory, type EpisodeHistoryInput } from "./use-mistake-episode-history";
const id=(n:number)=>`a3030000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const episode=(n:number)=>({episodeId:id(n),openedAt:"2026-10-02T00:00:00Z",resolvedAt:null,wrongCount:1,missedCount:0,includesLegacy:false});
const input:EpisodeHistoryInput={reader:{kind:"admin",studentId:id(1)},meaningKey:"a".repeat(64),upperVersion:"41",episodeCount:21,
  initial:Array.from({length:20},(_,n)=>episode(n+100)),initialCursor:"cursor",enabled:true,onInvalidated:vi.fn()};
const more={meaningKey:input.meaningKey,stateVersion:"41",episodeCount:21,items:[episode(90)],nextCursor:null};
beforeEach(()=>{vi.resetAllMocks();mocks.load.mockResolvedValue(more);});afterEach(cleanup);
describe("뜻의 이전 이력 더 보기",()=>{
  it("첫 20건에서 이어 읽고 클릭 중복과 끝난 더보기를 막는다",async()=>{
    const {result}=renderHook(()=>useMistakeEpisodeHistory(input));expect(mocks.load).not.toHaveBeenCalled();
    await act(async()=>{void result.current.loadMore();await result.current.loadMore();});
    expect(mocks.load).toHaveBeenCalledOnce();expect(result.current.items).toHaveLength(21);expect(result.current.canLoadMore).toBe(false);
    await act(async()=>result.current.loadMore());expect(mocks.load).toHaveBeenCalledOnce();
  });
  it("장애에는 읽은 이력을 보존하고 같은 커서로 다시 시도한다",async()=>{
    mocks.load.mockRejectedValueOnce(new Error("offline"));
    const {result}=renderHook(()=>useMistakeEpisodeHistory(input));await act(async()=>result.current.loadMore());
    expect(result.current.items).toHaveLength(20);expect(result.current.error).toContain("다시 시도");
    await act(async()=>result.current.loadMore());expect(result.current.items).toHaveLength(21);
    expect(mocks.load.mock.calls[1][1]).toEqual(mocks.load.mock.calls[0][1]);
  });
  it.each([401,403,409])("%i는 이력을 숨기고 소유 화면도 무효화한다",async status=>{
    mocks.load.mockRejectedValueOnce(new MistakeEpisodeHistoryError(status));
    const {result}=renderHook(()=>useMistakeEpisodeHistory(input));await act(async()=>result.current.loadMore());
    expect(result.current.items).toEqual([]);expect(input.onInvalidated).toHaveBeenCalledWith(status);
    await act(async()=>result.current.loadMore());expect(mocks.load).toHaveBeenCalledOnce();
  });
  it("학생·뜻 변경과 비활성화에서 늦은 응답은 버리고 초기 이력으로 돌아간다",async()=>{
    let finish!:(value:typeof more)=>void;mocks.load.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
    const {result,rerender}=renderHook(value=>useMistakeEpisodeHistory(value),{initialProps:input});
    act(()=>{void result.current.loadMore();});const signal=mocks.load.mock.calls[0][2] as AbortSignal;
    rerender({...input,enabled:false});expect(signal.aborted).toBe(true);expect(result.current.items).toEqual([]);
    rerender({...input,reader:{kind:"admin",studentId:id(2)},initial:[episode(200)],episodeCount:1,initialCursor:null});
    await act(async()=>finish(more));expect(result.current.items).toEqual([episode(200)]);expect(result.current.busy).toBe(false);
  });
  it("중복·새 상한으로 바뀐 수·빠진 마지막 이력은 붙이지 않는다",async()=>{
    for(const page of [{...more,items:[input.initial[0]]},{...more,episodeCount:22},{...more,items:[]}]){
      mocks.load.mockResolvedValueOnce(page);const mounted=renderHook(()=>useMistakeEpisodeHistory(input));
      await act(async()=>mounted.result.current.loadMore());expect(mounted.result.current.items).toEqual([]);
      expect(input.onInvalidated).toHaveBeenLastCalledWith(409);mounted.unmount();
    }
  });
});
