/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { announceStudentPrivateCacheChange, subscribeStudentPrivateCacheChanges } from "./student-private-cache-events";
import { requestStudentLogin, requestStudentLogout } from "./student-session-commands";
afterEach(()=>vi.unstubAllGlobals());
describe("학생 개인 자료 변경 신호",()=>{
  it("종류와 임의 식별자만 전송하고 중복·잘못된 신호는 무시한다",()=>{
    const posts:unknown[]=[];
    vi.stubGlobal("BroadcastChannel",class {onmessage:unknown;postMessage(value:unknown){posts.push(value);}close(){}});
    const listener=vi.fn(),stop=subscribeStudentPrivateCacheChanges(listener);
    announceStudentPrivateCacheChange("mistakes");expect(listener).toHaveBeenCalledWith("mistakes");
    expect(Object.keys(posts[0] as object).sort()).toEqual(["kind","nonce"]);
    window.dispatchEvent(new StorageEvent("storage",{key:"student-private-cache-signal",newValue:JSON.stringify(posts[0])}));
    window.dispatchEvent(new StorageEvent("storage",{key:"student-private-cache-signal",newValue:'{"kind":"identity"}'}));
    expect(listener).toHaveBeenCalledOnce();stop();
  });
  it("로그아웃 전 표시를 폐기하고 실패해도 복원하지 않는다",async()=>{
    vi.stubGlobal("BroadcastChannel",undefined);const listener=vi.fn(),stop=subscribeStudentPrivateCacheChanges(listener);
    vi.stubGlobal("fetch",vi.fn(async()=>{expect(listener).toHaveBeenCalledWith("identity");throw new Error("offline");}));
    await expect(requestStudentLogout()).rejects.toThrow("offline");expect(listener).toHaveBeenCalledOnce();stop();
  });
  it("학생 로그인 성공 시에만 다른 탭의 자료를 비운다",async()=>{
    vi.stubGlobal("BroadcastChannel",undefined);const listener=vi.fn(),stop=subscribeStudentPrivateCacheChanges(listener);
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(Response.json({},{status:401})).mockResolvedValueOnce(Response.json({})));
    await requestStudentLogin("FAKE1234",new AbortController().signal);expect(listener).not.toHaveBeenCalled();
    await requestStudentLogin("FAKE1234",new AbortController().signal);expect(listener).toHaveBeenCalledWith("identity");stop();
  });
});
