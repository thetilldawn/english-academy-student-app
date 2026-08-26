// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  renew: vi.fn<
    (
      signal: AbortSignal,
    ) => Promise<
      | { status: "ok"; nextCheckInMilliseconds: number }
      | { status: "invalid" | "retry" | "aborted" }
    >
  >(async () => ({ status: "ok", nextCheckInMilliseconds: 24 * 60 * 60 * 1000 })),
}));

vi.mock("../api/session", () => ({
  requestStudentSessionRenewal: mocks.renew,
}));

import { StudentSessionRenewal } from "./student-session-renewal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

describe("StudentSessionRenewal", () => {
  it("서버가 계산한 시각까지 기다리고 성공 뒤 24시간에 한 번만 갱신한다", async () => {
    vi.useFakeTimers();
    render(<StudentSessionRenewal initialDelayMilliseconds={1_000} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(mocks.renew).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.renew).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        24 * 60 * 60 * 1000 - 1,
      );
    });
    expect(mocks.renew).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.renew).toHaveBeenCalledTimes(2);
  });

  it("일시 실패는 15분 뒤에만 다시 시도한다", async () => {
    vi.useFakeTimers();
    mocks.renew.mockResolvedValueOnce({ status: "retry" });
    render(<StudentSessionRenewal initialDelayMilliseconds={0} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.renew).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000 - 1);
    });
    expect(mocks.renew).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.renew).toHaveBeenCalledTimes(2);
  });

  it("숨긴 탭에서는 갱신하지 않고 다시 보일 때 밀린 갱신을 실행한다", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    render(<StudentSessionRenewal initialDelayMilliseconds={1_000} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(mocks.renew).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.renew).toHaveBeenCalledOnce();
  });
});
