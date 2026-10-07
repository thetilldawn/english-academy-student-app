// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSelectedLayoutSegments: () => ["assignments"] }));
import { usePrivateListSession } from "./use-private-list-session";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("한 번 숨겼다 돌아오는 여러 이벤트는 인증 복귀표를 한 번만 바꾼다", () => {
  let visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility as DocumentVisibilityState);
  const cache = { blocked: false, revision: 0, subscribe: () => () => undefined, lock: vi.fn(), invalidate: vi.fn(), cancelRequests: vi.fn() };
  const { result } = renderHook(() => usePrivateListSession(cache));
  const initial = result.current.ticket;
  act(() => window.dispatchEvent(new Event("pageshow")));
  expect(result.current.ticket).toBe(initial);
  act(() => { visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("pagehide")); });
  expect(cache.cancelRequests).toHaveBeenCalledOnce();
  act(() => { visibility = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
  const restored = result.current.ticket;
  act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  act(() => window.dispatchEvent(new Event("online")));
  expect(result.current.ticket).toBe(restored);
  expect(restored).not.toBe(initial);
});
