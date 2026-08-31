import { afterEach, describe, expect, it, vi } from "vitest";

import {
  awaitWithAbortSignal,
  createDeadlineFetch,
  createRequestDeadline,
  INTERACTIVE_READ_REQUEST_DEADLINE_MS,
  requestTimeoutWithinBudget,
} from "./request-policy";

afterEach(() => {
  vi.useRealTimers();
});

describe("request deadline policy", () => {
  it("정해진 시각 전에는 유지하고 도달하면 표준 취소 신호를 보낸다", async () => {
    vi.useFakeTimers();
    const deadline = createRequestDeadline(
      INTERACTIVE_READ_REQUEST_DEADLINE_MS,
    );

    await vi.advanceTimersByTimeAsync(6_999);
    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.expired).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toBeInstanceOf(DOMException);
    expect(deadline.expired).toBe(true);
    deadline.dispose();
  });

  it("상위 요청 취소와 자체 시간 초과를 구분한다", () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const deadline = createRequestDeadline(7_000, parent.signal);

    parent.abort();

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.expired).toBe(false);
    deadline.dispose();
  });

  it("작업이 끝난 뒤에는 타이머가 요청을 취소하지 않는다", async () => {
    vi.useFakeTimers();
    const deadline = createRequestDeadline(7_000);
    deadline.dispose();

    await vi.advanceTimersByTimeAsync(7_000);
    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.expired).toBe(false);
  });

  it("고정 제한 신호와 호출별 신호를 실제 fetch에 함께 전달한다", async () => {
    const deadline = new AbortController();
    const caller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const implementation = vi.fn<typeof fetch>(async (_input, init) => {
      receivedSignal = init?.signal ?? undefined;
      return Response.json({ ok: true });
    });
    const deadlineFetch = createDeadlineFetch(
      deadline.signal,
      implementation,
    );

    const response = await deadlineFetch("https://example.test", {
      signal: caller.signal,
    });
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal).not.toBe(deadline.signal);
    expect(receivedSignal).not.toBe(caller.signal);

    caller.abort();
    expect(receivedSignal?.aborted).toBe(true);
    expect(response).toBeInstanceOf(Response);
  });

  it("작업이 취소 신호를 무시해도 제한 시각에 기다림을 끝낸다", async () => {
    vi.useFakeTimers();
    const deadline = createRequestDeadline(7_000);
    const result = awaitWithAbortSignal(
      new Promise<never>(() => {}),
      deadline.signal,
    );
    const expectation = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });

    await vi.advanceTimersByTimeAsync(7_000);

    await expectation;
    expect(deadline.expired).toBe(true);
    deadline.dispose();
  });

  it("제한시간 취소는 SDK가 재시도하지 않을 408 응답으로 정리한다", async () => {
    const deadline = new AbortController();
    const implementation = vi.fn<typeof fetch>((_input, init) => new Promise(
      (_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(
          new DOMException("aborted", "AbortError"),
        ), { once: true });
      },
    ));
    const deadlineFetch = createDeadlineFetch(
      deadline.signal,
      implementation,
    );

    const responsePromise = deadlineFetch("https://example.test");
    deadline.abort();
    const response = await responsePromise;

    expect(response.status).toBe(408);
    await expect(response.json()).resolves.toMatchObject({
      code: "request_timeout",
    });
    expect(implementation).toHaveBeenCalledTimes(1);
  });

  it("앞 단계가 쓴 시간을 빼고 남은 전체 요청 예산만 사용한다", () => {
    expect(requestTimeoutWithinBudget(5_000, 10_000, 7_000)).toBe(3_000);
    expect(requestTimeoutWithinBudget(7_000, 10_000, 11_000)).toBe(1);
    expect(requestTimeoutWithinBudget(5_000, null, 7_000)).toBe(5_000);
  });
});
