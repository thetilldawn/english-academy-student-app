// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("../transport/library-transport",()=>({readLibraryPage:mocks.read}));
import { useLibraryPage } from "./use-library-page";
import type { LibraryQuery, LibraryQueryResultOf } from "../../contracts/library-query";
const query=(search=""):Extract<LibraryQuery,{kind:"templates"}>=>({kind:"templates",search,cursor:null,limit:20});
const page=(more=false):LibraryQueryResultOf<"templates">=>({kind:"templates",viewerId:"actor",items:[],nextCursor:more?{binding:"a".repeat(64),snapshot:1,after:"20"}:null});
const onError=vi.fn(),onViewer=vi.fn();
beforeEach(()=>{vi.useFakeTimers();vi.resetAllMocks();});
afterEach(()=>{cleanup();vi.useRealTimers();});
const tick=()=>act(async()=>{await vi.advanceTimersByTimeAsync(251);});
it("queries nothing while closed, uses the returned cursor and resets paging when the search changes",async()=>{
  mocks.read.mockResolvedValue(page(true));
  const {result,rerender}=renderHook(({q})=>useLibraryPage(q,"actor",onError,onViewer),{initialProps:{q:null as ReturnType<typeof query>|null}});
  await tick();expect(mocks.read).not.toHaveBeenCalled();rerender({q:query()});await tick();expect(mocks.read).toHaveBeenCalledTimes(1);
  act(()=>result.current.more());await tick();expect(mocks.read.mock.calls[1]![0].cursor).toEqual(page(true).nextCursor);
  rerender({q:query("2025 주제")});expect(result.current.data).toBeNull();expect(result.current.status).toBe("loading");await tick();expect(mocks.read.mock.calls[2]![0].cursor).toBeNull();
});
it("aborts obsolete queries and ignores their late success without restoring the previous viewer",async()=>{
  let finish:(value:ReturnType<typeof page>)=>void=()=>undefined;mocks.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(page());
  const {result,rerender}=renderHook(({q})=>useLibraryPage(q,"actor",onError,onViewer),{initialProps:{q:query("old")}});await tick();const signal=mocks.read.mock.calls[0]![1] as AbortSignal;
  rerender({q:query("new")});expect(signal.aborted).toBe(true);await tick();await act(async()=>finish({...page(),viewerId:"stale"}));
  expect(result.current.data?.viewerId).toBe("actor");expect(onViewer).toHaveBeenCalledTimes(1);expect(onViewer).toHaveBeenCalledWith("actor");
});
it("keeps failed pagination distinct from empty data and reloads the first page on retry",async()=>{
  mocks.read.mockResolvedValueOnce(page(true)).mockRejectedValueOnce(new Error("다시 확인" )).mockResolvedValue(page());
  const {result}=renderHook(()=>useLibraryPage(query(),"actor",onError));await tick();act(()=>result.current.more());await tick();
  expect(result.current.status).toBe("error");expect(result.current.data).not.toBeNull();expect(result.current.error).toBe("다시 확인");act(()=>result.current.reload());expect(result.current.data).toBeNull();await tick();
  expect(mocks.read.mock.calls[2]![0].cursor).toBeNull();expect(result.current.status).toBe("ready");
});
