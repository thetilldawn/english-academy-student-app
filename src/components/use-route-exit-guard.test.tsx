// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "react-dom";
import { ConfirmationProvider } from "@/design-system/patterns/confirmation/confirmation";
import { useRouteExitGuard } from "./use-route-exit-guard";

const BASE_KEY = "__routeExitGuardBase";
const SENTINEL_KEY = "__routeExitGuardSentinel";
function renderGuard({ busy = false, dirty = true } = {}) {
  return renderHook(({ currentBusy, currentDirty }) => useRouteExitGuard({
    busy: currentBusy, dirty: currentDirty,
    confirmMessage: "변경 내용을 버리고 이동할까요?", idPrefix: "test-editor",
  }), { initialProps: { currentBusy: busy, currentDirty: dirty }, wrapper: ConfirmationProvider });
}
function currentBaseState() {
  const state = { ...window.history.state };
  delete state[SENTINEL_KEY];
  return state;
}
function pop(state: Record<string, unknown>, href = window.location.href) {
  window.history.replaceState(state, "", href);
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}
async function decide(accepted: boolean) {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: accepted ? "그만두기" : "취소" })); });
}
function beforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
beforeEach(() => {
  window.history.replaceState({ __NA: true, route: "editor" }, "", "/admin/students/student-1");
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { fn(0); return 1; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

describe("asynchronous route exit guard", () => {
  it("intercepts synchronously and preserves the draft when cancelled", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const exit = vi.fn();
    const { result } = renderGuard();
    act(() => { expect(result.current.requestExit(exit)).toBe(true); });
    expect(exit).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("변경 내용을 버리고 이동할까요?");
    await decide(false);
    expect(exit).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(beforeUnload()).toBe(true);
    act(() => { expect(result.current.requestExit(exit)).toBe(true); });
    await decide(false);
  });

  it("removes the sentinel before running one approved continuation", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const exit = vi.fn(() => { expect(beforeUnload()).toBe(false); });
    const { result } = renderGuard();
    const base = currentBaseState();
    act(() => { result.current.requestExit(exit); });
    await decide(true);
    expect(back).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    act(() => pop(base));
    await waitFor(() => expect(exit).toHaveBeenCalledOnce());
  });

  it("blocks a second request both while asking and during navigation", async () => {
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { result } = renderGuard();
    act(() => {
      expect(result.current.requestExit(vi.fn())).toBe(true);
      expect(result.current.requestExit(vi.fn())).toBe(false);
    });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await decide(true);
    expect(result.current.requestExit(vi.fn())).toBe(false);
  });

  it("does not ask or leave while saving", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { result } = renderGuard({ busy: true });
    expect(result.current.requestExit(vi.fn())).toBe(false);
    expect(await result.current.canExit()).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(back).not.toHaveBeenCalled();
  });

  it("ignores an approval if saving starts before the navigation microtask", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const exit = vi.fn();
    const { result, rerender } = renderGuard();
    act(() => result.current.requestExit(exit));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "그만두기" }));
      queueMicrotask(() => flushSync(() => rerender({ currentBusy: true, currentDirty: true })));
    });
    expect(back).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(beforeUnload()).toBe(true);
  });

  it("preserves a saved continuation while a multi-entry Back is being restored", async () => {
    vi.spyOn(window.history, "forward").mockImplementation(() => {});
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const saved = vi.fn();
    const { result } = renderGuard({ busy: true });
    const sentinel = { ...window.history.state };
    const base = currentBaseState();
    act(() => pop({ __NA: true, route: "earlier" }, "/admin/results"));
    act(() => { expect(result.current.forceExit(saved)).toBe(true); });
    act(() => pop(base, "/admin/students/student-1"));
    act(() => pop(sentinel));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(back).toHaveBeenCalledOnce();
    act(() => pop(base));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  });

  it.each(["false", "throw", "reject"] as const)("rearms after a %s continuation failure", async (mode) => {
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    const push = vi.spyOn(window.history, "pushState");
    const { result } = renderGuard();
    const base = currentBaseState();
    act(() => result.current.requestExit(() => {
      if (mode === "throw") throw new Error("failure");
      if (mode === "reject") return Promise.reject(new Error("failure"));
      return false;
    }));
    await decide(true);
    push.mockClear();
    act(() => pop(base));
    await waitFor(() => expect(push).toHaveBeenCalledOnce());
    expect(beforeUnload()).toBe(true);
    act(() => { expect(result.current.requestExit(vi.fn())).toBe(true); });
    await decide(false);
  });

  it("does not rearm a departed document after a failed continuation", async () => {
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    const push = vi.spyOn(window.history, "pushState");
    const { result } = renderGuard();
    const base = currentBaseState();
    act(() => result.current.requestExit(() => { window.history.replaceState({}, "", "/admin/results"); return false; }));
    await decide(true);
    push.mockClear();
    act(() => pop(base));
    await waitFor(() => expect(window.location.pathname).toBe("/admin/results"));
    expect(push).not.toHaveBeenCalled();
  });

  it("restores a browser Back before asking so Next cannot replace the backdrop", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const nextPop = vi.fn();
    window.addEventListener("popstate", nextPop);
    renderGuard();
    const base = currentBaseState();
    act(() => pop(base));
    expect(window.history.state[SENTINEL_KEY]).toEqual(expect.any(String));
    expect(nextPop).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    await decide(false);
    expect(beforeUnload()).toBe(true);
    window.removeEventListener("popstate", nextPop);
  });

  it("replays approved browser Back after restoring and removing its sentinel", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    renderGuard();
    const base = currentBaseState();
    act(() => pop(base));
    await decide(true);
    expect(back).toHaveBeenCalledOnce();
    act(() => pop(base));
    await waitFor(() => expect(back).toHaveBeenCalledTimes(2));
  });

  it.each([false, true])("restores multi-entry Back without copying another Next state; accepted=%s", async accepted => {
    const forward = vi.spyOn(window.history, "forward").mockImplementation(() => {});
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    const push = vi.spyOn(window.history, "pushState");
    renderGuard();
    const sentinel = { ...window.history.state };
    const base = currentBaseState();
    push.mockClear();
    act(() => pop({ __NA: true, route: "other" }, "/admin/results"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(forward).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    act(() => pop(base, "/admin/students/student-1"));
    expect(forward).toHaveBeenCalledTimes(2);
    act(() => pop(sentinel));
    expect(window.history.state.route).toBe("editor");
    await decide(accepted);
    if (accepted) {
      act(() => pop(base));
      await waitFor(() => expect(go).toHaveBeenCalledWith(-1));
    } else {
      expect(go).not.toHaveBeenCalled();
      expect(beforeUnload()).toBe(true);
    }
  });

  it("cancels a pending decision on unmount or when saving starts", async () => {
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    const exit = vi.fn();
    const { result, rerender, unmount } = renderGuard();
    act(() => result.current.requestExit(exit));
    rerender({ currentBusy: true, currentDirty: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(exit).not.toHaveBeenCalled();
    rerender({ currentBusy: false, currentDirty: true });
    act(() => result.current.requestExit(exit));
    unmount();
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();
  });

  it("a completed save cancels the old confirmation and executes its own continuation", async () => {
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    const oldExit = vi.fn(), savedExit = vi.fn();
    const { result } = renderGuard();
    const base = currentBaseState();
    act(() => result.current.requestExit(oldExit));
    act(() => result.current.forceExit(savedExit));
    act(() => pop(base));
    await waitFor(() => expect(savedExit).toHaveBeenCalledOnce());
    expect(oldExit).not.toHaveBeenCalled();
  });

  it("same-document hashes retain one protection entry", () => {
    const push = vi.spyOn(window.history, "pushState");
    const target = document.createElement("main");
    target.id = "main-content"; target.scrollIntoView = vi.fn();
    const anchor = document.createElement("a");
    anchor.href = window.location.href + "#main-content";
    document.body.append(target, anchor);
    renderGuard(); push.mockClear();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(push).not.toHaveBeenCalled();
    expect(target.scrollIntoView).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    anchor.remove(); target.remove();
  });

  it("removes clean protection and skips an inactive leftover sentinel", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { rerender } = renderGuard();
    const id = window.history.state[SENTINEL_KEY], base = currentBaseState();
    rerender({ currentBusy: false, currentDirty: false });
    expect(back).toHaveBeenCalledOnce();
    act(() => pop(base));
    expect(window.history.state[BASE_KEY]).toBeUndefined();
    back.mockClear();
    act(() => pop({ [SENTINEL_KEY]: id }));
    expect(back).toHaveBeenCalledOnce();
    expect(window.history.state[SENTINEL_KEY]).toBeUndefined();
  });

  it("never modifies another inactive editor's protection", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    renderGuard({ dirty: false });
    act(() => pop({ [SENTINEL_KEY]: "another-editor" }));
    expect(back).not.toHaveBeenCalled();
    expect(window.history.state[SENTINEL_KEY]).toBe("another-editor");
  });
});
