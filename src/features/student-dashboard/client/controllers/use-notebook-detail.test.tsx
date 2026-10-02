/** @vitest-environment jsdom */
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeMistakePage } from "@/features/students/controller/mistake-test-fixtures";
import { announceStudentPrivateCacheChange } from "@/features/session/public-client";
const mocks=vi.hoisted(()=>({load:vi.fn()}));
vi.mock("../transport/notebook-transport",async()=>({...await vi.importActual("../transport/notebook-transport"),loadNotebookWord:mocks.load}));
import { NotebookRequestError } from "../transport/notebook-transport";
import { useNotebookDetail } from "./use-notebook-detail";
const word={...fakeMistakePage().items[0],pronunciation:{displayKo:null,variantId:null,audioUrl:null,available:false},definition:null,example:null,exampleKo:null};
const input={word,view:"current" as const,identity:"fake-scope",initialIdentity:"fake-scope",enabled:true};
beforeEach(()=>{vi.resetAllMocks();mocks.load.mockResolvedValue(word);});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe("독립 상세 화면의 현재 인증",()=>{
  it("최초 화면에서 출처만 바뀌어도 이전 본문을 숨기고 다시 확인한다",async()=>{
    const Probe=({sourceWord=word})=>{const state=useNotebookDetail({...input,word:sourceWord});return <p>{state.word?.primaryMeaning??"확인 중"}</p>;};
    const container=document.createElement("div");container.innerHTML=renderToString(<Probe/>);document.body.appendChild(container);
    const mounted=render(<Probe/>,{container,hydrate:true});expect(mocks.load).not.toHaveBeenCalled();
    let finish!:(value:typeof word)=>void;mocks.load.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
    const revised={...word,sourceVersion:"f".repeat(64),primaryMeaning:"새 출처의 뜻"};mounted.rerender(<Probe sourceWord={revised}/>);
    expect(container.textContent).toBe("확인 중");await waitFor(()=>expect(mocks.load).toHaveBeenCalledOnce());
    await act(async()=>finish(revised));expect(container.textContent).toBe("새 출처의 뜻");
  });
  it("되돌아온 화면의 옛 본문은 조회 성공 전까지 숨긴다",async()=>{
    let finish!:(value:typeof word)=>void;mocks.load.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
    const {result}=renderHook(()=>useNotebookDetail(input));expect(result.current.word).toBeNull();
    await waitFor(()=>expect(mocks.load).toHaveBeenCalledOnce());
    await act(async()=>finish({...word,primaryMeaning:"다시 확인한 뜻"}));
    expect(result.current.word?.primaryMeaning).toBe("다시 확인한 뜻");
  });
  it("숨김에서 취소하고 복귀 때 재확인하며 늦은 이전 응답은 버린다",async()=>{
    const {result}=renderHook(()=>useNotebookDetail(input));await waitFor(()=>expect(result.current.word).toEqual(word));
    let finish!:(value:typeof word)=>void;mocks.load.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
    await act(async()=>announceStudentPrivateCacheChange("mistakes"));
    const signal=mocks.load.mock.calls[1][3] as AbortSignal;
    let visibility:DocumentVisibilityState="hidden";vi.spyOn(document,"visibilityState","get").mockImplementation(()=>visibility);
    act(()=>document.dispatchEvent(new Event("visibilitychange")));expect(signal.aborted).toBe(true);
    await act(async()=>finish(word));expect(result.current.word).toBeNull();
    await act(async()=>{visibility="visible";document.dispatchEvent(new Event("visibilitychange"));window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}));});
    expect(mocks.load).toHaveBeenCalledTimes(3);expect(result.current.word).toEqual(word);
  });
  it("401 뒤에는 새 응답이나 복귀로 잠금을 풀지 않는다",async()=>{
    mocks.load.mockRejectedValueOnce(new NotebookRequestError(401));
    const {result}=renderHook(()=>useNotebookDetail(input));await waitFor(()=>expect(result.current.denied).toBe(true));
    await act(async()=>{await result.current.retry();announceStudentPrivateCacheChange("mistakes");});
    expect(mocks.load).toHaveBeenCalledOnce();expect(result.current.word).toBeNull();
  });
});
