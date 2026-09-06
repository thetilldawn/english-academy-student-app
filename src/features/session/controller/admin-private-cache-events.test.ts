/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { announceAdminPrivateCacheChange, subscribeAdminPrivateCacheChanges } from "./admin-private-cache-events";
import { requestAdminLogin, requestAdminLogout } from "./admin-session-commands";
afterEach(() => vi.unstubAllGlobals());
describe("개인 캐시 세션 신호", () => {
  it("같은 탭 방송은 구독자마다 한 번, 외부의 다른 신호는 각각 한 번 받는다", async () => {
    class Channel {
      static instances: Channel[] = [];
      onmessage: ((event: MessageEvent) => void) | null = null;
      closed = false;
      constructor() { Channel.instances.push(this); }
      postMessage(value: unknown) {
        for (const receiver of Channel.instances.filter(item => item !== this && !item.closed)) {
          queueMicrotask(() => { if (!receiver.closed) receiver.onmessage?.(new MessageEvent("message", { data: value })); });
        }
      }
      close() { this.closed = true; }
    }
    vi.stubGlobal("BroadcastChannel", Channel);
    const one = vi.fn(), two = vi.fn();
    const stopOne = subscribeAdminPrivateCacheChanges(one), stopTwo = subscribeAdminPrivateCacheChanges(two);
    announceAdminPrivateCacheChange("students"); await Promise.resolve();
    expect(one).toHaveBeenCalledTimes(1); expect(two).toHaveBeenCalledTimes(1);
    const remote = new Channel();
    remote.postMessage({ kind: "students", nonce: "external-1" }); remote.postMessage({ kind: "students", nonce: "external-1" });
    remote.postMessage({ kind: "identity", nonce: "external-2" }); await Promise.resolve();
    expect(one).toHaveBeenCalledTimes(3); expect(two).toHaveBeenCalledTimes(3);
    expect(one).toHaveBeenLastCalledWith("identity", true);
    stopOne(); stopTwo(); announceAdminPrivateCacheChange("identity"); await Promise.resolve();
    expect(one).toHaveBeenCalledTimes(3); expect(two).toHaveBeenCalledTimes(3); remote.close();
  });
  it("다른 탭에는 종류와 난수만 보내고 구독을 해제한다", () => {
    const posts: unknown[] = [];
    vi.stubGlobal("BroadcastChannel", class { onmessage = null; postMessage(v: unknown) { posts.push(v); } close() {} });
    const listener = vi.fn(); const stop = subscribeAdminPrivateCacheChanges(listener);
    announceAdminPrivateCacheChange("students"); expect(listener).toHaveBeenCalledWith("students", false);
    expect(Object.keys(posts[0] as object).sort()).toEqual(["kind", "nonce"]);
    stop(); announceAdminPrivateCacheChange("identity"); expect(listener).toHaveBeenCalledTimes(1);
  });
  it("방송을 못 쓰면 개인 정보 없는 저장소 신호를 수신한다", () => {
    vi.stubGlobal("BroadcastChannel", undefined); const listener = vi.fn(); const stop = subscribeAdminPrivateCacheChanges(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: "admin-private-cache-signal", newValue: JSON.stringify({ kind: "identity", nonce: "fake" }) }));
    expect(listener).toHaveBeenCalledWith("identity", true);
    window.dispatchEvent(new StorageEvent("storage", { key: "admin-private-cache-signal", newValue: "bad" }));
    expect(listener).toHaveBeenCalledTimes(1); stop();
  });
  it("로그아웃 요청을 보내기 전에 비우며 실패해도 복원 신호가 없다", async () => {
    const listener = vi.fn(); const stop = subscribeAdminPrivateCacheChanges(listener);
    vi.stubGlobal("fetch", vi.fn(async () => { expect(listener).toHaveBeenCalledWith("identity", false); throw new Error("offline"); }));
    await expect(requestAdminLogout()).rejects.toThrow("offline"); expect(listener).toHaveBeenCalledTimes(1); stop();
  });
  it("로그인 성공만 기존 탭 캐시를 폐기한다", async () => {
    const listener = vi.fn(); const stop = subscribeAdminPrivateCacheChanges(listener);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({}, { status: 401 })).mockResolvedValueOnce(Response.json({})));
    const input = { email: "fake@example.invalid", password: "fake-only" }, signal = new AbortController().signal;
    await requestAdminLogin(input, signal); expect(listener).not.toHaveBeenCalled();
    await requestAdminLogin(input, signal); expect(listener).toHaveBeenCalledWith("identity", false); stop();
  });
});
