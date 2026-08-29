// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRouteExitGuard } from "./use-route-exit-guard";

const BASE_KEY = "__routeExitGuardBase";
const SENTINEL_KEY = "__routeExitGuardSentinel";

function renderGuard({ busy = false, dirty = true } = {}) {
  return renderHook(
    ({ currentBusy, currentDirty }) => useRouteExitGuard({
      busy: currentBusy,
      confirmMessage: "변경 내용을 버리고 이동할까요?",
      dirty: currentDirty,
      idPrefix: "test-editor",
    }),
    { initialProps: { currentBusy: busy, currentDirty: dirty } },
  );
}

function currentBaseState() {
  const state = { ...(window.history.state as Record<string, unknown>) };
  delete state[SENTINEL_KEY];
  return state;
}

function dispatchPopState(state: Record<string, unknown>) {
  window.history.replaceState(state, "", window.location.href);
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}

function dispatchBeforeUnload() {
  const event = new Event("beforeunload", {
    cancelable: true,
  }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/admin/students/student-1");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("useRouteExitGuard", () => {
  it("변경 내용을 버리지 않으면 프로그램 이동을 취소한다", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const exit = vi.fn();
    const { result } = renderGuard();

    expect(result.current.requestExit(exit)).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(back).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("확인한 프로그램 이동은 보호 기록을 먼저 제거한 뒤 한 번 실행한다", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const exit = vi.fn();
    const { result } = renderGuard();
    const baseState = currentBaseState();

    expect(result.current.requestExit(exit)).toBe(true);
    expect(back).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();

    act(() => dispatchPopState(baseState));
    await waitFor(() => expect(exit).toHaveBeenCalledOnce());
  });

  it("does not warn again while an approved document exit continues", async () => {
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const beforeUnloadBlocked = vi.fn();
    const { result } = renderGuard();
    const baseState = currentBaseState();

    expect(result.current.requestExit(() => {
      beforeUnloadBlocked(dispatchBeforeUnload());
    })).toBe(true);
    act(() => dispatchPopState(baseState));

    await waitFor(() => expect(beforeUnloadBlocked).toHaveBeenCalledWith(false));
  });

  it("keeps the document warning active when a guarded exit is cancelled", () => {
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderGuard();

    expect(result.current.requestExit(vi.fn())).toBe(false);
    expect(dispatchBeforeUnload()).toBe(true);
  });

  it("저장 중에는 확인창 없이 모든 프로그램 이동을 막는다", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const confirm = vi.spyOn(window, "confirm");
    const exit = vi.fn();
    const { result } = renderGuard({ busy: true, dirty: true });

    expect(result.current.requestExit(exit)).toBe(false);
    expect(result.current.canExit()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("비동기 이동이 실패하면 보호 기록을 복구하고 다시 시도할 수 있다", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const pushState = vi.spyOn(window.history, "pushState");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const failedExit = vi.fn(async () => false);
    const retryExit = vi.fn();
    const { result } = renderGuard();
    const baseState = currentBaseState();
    pushState.mockClear();

    expect(result.current.requestExit(failedExit)).toBe(true);
    act(() => dispatchPopState(baseState));

    await waitFor(() => expect(failedExit).toHaveBeenCalledOnce());
    await waitFor(() => expect(pushState).toHaveBeenCalledOnce());
    expect(window.history.state[SENTINEL_KEY]).toEqual(expect.any(String));
    expect(dispatchBeforeUnload()).toBe(true);
    expect(result.current.requestExit(retryExit)).toBe(true);
    expect(back).toHaveBeenCalledTimes(2);
  });

  it("비동기 이동이 예외로 끝나도 보호 기록을 복구한다", async () => {
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    const pushState = vi.spyOn(window.history, "pushState");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderGuard();
    const baseState = currentBaseState();
    pushState.mockClear();

    result.current.requestExit(async () => {
      throw new Error("logout failed");
    });
    act(() => dispatchPopState(baseState));

    await waitFor(() => expect(pushState).toHaveBeenCalledOnce());
    expect(window.history.state[SENTINEL_KEY]).toEqual(expect.any(String));
  });

  it("비동기 실패 전에 다른 화면으로 바뀌었으면 옛 편집 보호를 다시 세우지 않는다", async () => {
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    const pushState = vi.spyOn(window.history, "pushState");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderGuard();
    const baseState = currentBaseState();
    pushState.mockClear();

    result.current.requestExit(async () => {
      window.history.replaceState({}, "", "/admin/results");
      return false;
    });
    act(() => dispatchPopState(baseState));

    await waitFor(() => expect(window.location.pathname).toBe("/admin/results"));
    expect(pushState).not.toHaveBeenCalled();
  });

  it("이탈 처리가 끝나기 전에는 중복 요청을 받지 않는다", () => {
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const firstExit = vi.fn();
    const secondExit = vi.fn();
    const { result } = renderGuard();

    expect(result.current.requestExit(firstExit)).toBe(true);
    expect(result.current.requestExit(secondExit)).toBe(false);
    expect(firstExit).not.toHaveBeenCalled();
    expect(secondExit).not.toHaveBeenCalled();
  });

  it("브라우저 뒤로가기를 취소하면 같은 보호 기록을 다시 세운다", () => {
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    const pushState = vi.spyOn(window.history, "pushState");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderGuard();
    const baseState = currentBaseState();
    pushState.mockClear();

    act(() => dispatchPopState(baseState));

    expect(confirm).toHaveBeenCalledWith("변경 내용을 버리고 이동할까요?");
    expect(pushState).toHaveBeenCalledOnce();
  });

  it("브라우저 뒤로가기를 확인하면 실제 이전 기록으로 한 번 더 이동한다", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGuard();
    const baseState = currentBaseState();

    act(() => dispatchPopState(baseState));

    expect(back).toHaveBeenCalledOnce();
  });

  it("예상 밖의 다단계 뒤로가기를 승인하면 더 뒤로 넘기지 않는다", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGuard();

    act(() => dispatchPopState({ nextRouteState: "other-route" }));

    expect(back).not.toHaveBeenCalled();
  });

  it("예상 밖의 다단계 뒤로가기를 취소할 때 다른 Next 상태를 복사하지 않는다", () => {
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    const forward = vi.spyOn(window.history, "forward").mockImplementation(() => {});
    const pushState = vi.spyOn(window.history, "pushState");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderGuard();
    pushState.mockClear();

    act(() => dispatchPopState({ nextRouteState: "other-route" }));

    expect(forward).toHaveBeenCalledOnce();
    expect(pushState).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({ nextRouteState: "other-route" });
  });

  it("같은 문서의 해시 링크는 보호 기록을 늘리지 않고 현재 기록만 바꾼다", () => {
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    const confirm = vi.spyOn(window, "confirm");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const target = document.createElement("main");
    target.id = "main-content";
    target.scrollIntoView = vi.fn();
    document.body.append(target);
    const anchor = document.createElement("a");
    anchor.href = `${window.location.href.split("#")[0]}#main-content`;
    document.body.append(anchor);
    renderGuard();
    replaceState.mockClear();

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledOnce();
    expect(target.scrollIntoView).toHaveBeenCalledOnce();
    anchor.remove();
    target.remove();
  });

  it("변경 상태가 해제되면 보호 기록만 제거한다", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const confirm = vi.spyOn(window, "confirm");
    const { rerender } = renderGuard();
    const baseState = currentBaseState();

    rerender({ currentBusy: false, currentDirty: false });
    expect(back).toHaveBeenCalledOnce();
    act(() => dispatchPopState(baseState));
    expect(confirm).not.toHaveBeenCalled();
    expect(window.history.state[BASE_KEY]).toBeUndefined();
  });

  it("비활성 상태에서 남은 보호 기록을 만나면 해당 중복 기록을 건너뛴다", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { rerender } = renderGuard();
    const guardId = window.history.state[SENTINEL_KEY] as string;
    const baseState = currentBaseState();
    rerender({ currentBusy: false, currentDirty: false });
    act(() => dispatchPopState(baseState));
    back.mockClear();

    act(() => dispatchPopState({ [SENTINEL_KEY]: guardId }));

    expect(back).toHaveBeenCalledOnce();
    expect(window.history.state[SENTINEL_KEY]).toBeUndefined();
  });

  it("다른 편집기가 만든 보호 기록은 건드리지 않는다", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    renderGuard({ dirty: false });

    act(() => dispatchPopState({ [SENTINEL_KEY]: "another-editor" }));

    expect(back).not.toHaveBeenCalled();
    expect(window.history.state[SENTINEL_KEY]).toBe("another-editor");
  });
});
