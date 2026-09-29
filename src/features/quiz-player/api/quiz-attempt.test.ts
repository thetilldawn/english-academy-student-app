// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { expireQuizAttempt, recoverQuizAttempt, resumeQuizAfterFeedback, submitQuizAnswer } from "./quiz-attempt";
import { QUIZ_REQUEST_TIMEOUT_MS } from "../domain/quiz-session";

function response(payload: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json" },
      status: 200,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("quiz attempt transport", () => {
  const actions = {
    submit: () => submitQuizAnswer({ attemptId: "a", questionId: "q", phase: "initial", choiceIndex: 0 }),
    recover: () => recoverQuizAttempt("a"),
    feedback: () => resumeQuizAfterFeedback({ attemptId: "a", nextPhase: "initial", nextQuestionId: "q2", transitionRemainingMilliseconds: 150 }),
  };

  it.each(Object.keys(actions) as (keyof typeof actions)[])("%s: 본문이 취소를 무시해도 한도 내 종료하고 늦은 응답은 무시한다", async (name) => {
    vi.useFakeTimers();
    let resolveBody!: (value: unknown) => void;
    let signal!: AbortSignal;
    const json = vi.fn(() => new Promise(resolve => { resolveBody = resolve; }));
    vi.stubGlobal("fetch", vi.fn((_resource, init) => {
      signal = init.signal;
      return Promise.resolve({ ok: true, json });
    }));
    const success = vi.fn();
    const failure = vi.fn();
    const request = actions[name]().then(success, failure);
    await vi.advanceTimersByTimeAsync(QUIZ_REQUEST_TIMEOUT_MS - 1);
    expect(success).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await request;
    expect(failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: "AbortError" }));
    expect(signal.aborted).toBe(true);
    resolveBody({ expired: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(success).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("헤더와 본문에 각각 2초가 아니라 합산 2초를 적용한다", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => {
      setTimeout(() => resolve({ ok: true, json: () => new Promise(() => {}) }), 1_500);
    })));
    const rejected = expect(actions.submit()).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(QUIZ_REQUEST_TIMEOUT_MS);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("만료 요청 헤더가 취소를 무시해도 종료한다", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const rejected = expect(expireQuizAttempt("a")).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(QUIZ_REQUEST_TIMEOUT_MS);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("만료는 사용하지 않는 본문을 기다리지 않고 기존 Response를 반환한다", async () => {
    vi.useFakeTimers();
    const response = { ok: true, json: vi.fn(() => new Promise(() => {})) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    expect(await expireQuizAttempt("a")).toBe(response);
    expect(response.json).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 503])("잘못된 JSON(%i)을 무한 대기하지 않고 기존 성공 검증/실패로 넘긴다", async (status) => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invalid", { status })));
    if (status === 200) await expect(actions.submit()).rejects.toThrow();
    else expect(await actions.submit()).toMatchObject({ ok: false, payload: {} });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("accepts the complete next-question timer tuple", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        response({
          correct: true,
          correctChoiceIndex: 0,
          nextPhase: "initial",
          nextQuestionId: "question-2",
          questionDeadlineAt: "2099-01-01T00:00:10.500Z",
          timerRemainingMilliseconds: 10_500,
        }),
      ),
    );

    const result = await submitQuizAnswer({
      attemptId: "attempt-1",
      choiceIndex: 0,
      phase: "initial",
      questionId: "question-1",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a successful next-question response without its deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        response({
          correct: true,
          correctChoiceIndex: 0,
          nextPhase: "initial",
          nextQuestionId: "question-2",
          timerRemainingMilliseconds: 10_500,
        }),
      ),
    );

    await expect(
      submitQuizAnswer({
        attemptId: "attempt-1",
        choiceIndex: 0,
        phase: "initial",
        questionId: "question-1",
      }),
    ).rejects.toThrow("quiz answer response is missing the next timer state");
  });

  it("accepts a terminal answer without a next-question timer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        response({
          completed: true,
          correct: true,
          correctChoiceIndex: 0,
        }),
      ),
    );

    const result = await submitQuizAnswer({
      attemptId: "attempt-1",
      choiceIndex: 0,
      phase: "initial",
      questionId: "question-1",
    });
    expect(result.ok).toBe(true);
  });

  it("submits the exact next-question identity for audio-ended timing", async () => {
    const fetchMock = vi.fn(() =>
      response({
        questionDeadlineAt: "2099-01-01T00:00:10.150Z",
        questionStartsAt: "2099-01-01T00:00:00.150Z",
        timerRemainingMilliseconds: 10_150,
        transitionRemainingMilliseconds: 150,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await resumeQuizAfterFeedback({
      attemptId: "attempt-1",
      nextPhase: "initial",
      nextQuestionId: "question-2",
      transitionRemainingMilliseconds: 150,
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/student/attempts/attempt-1/feedback",
      expect.objectContaining({
        body: JSON.stringify({
          nextPhase: "initial",
          nextQuestionId: "question-2",
          transitionRemainingMilliseconds: 150,
        }),
        method: "POST",
      }),
    );
  });

  it("aborts a feedback synchronization request that stops responding", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_resource: RequestInfo | URL, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      ),
    );

    const request = resumeQuizAfterFeedback({
      attemptId: "attempt-1",
      nextPhase: "initial",
      nextQuestionId: "question-2",
      transitionRemainingMilliseconds: 150,
    });
    const rejection = expect(request).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await rejection;
  });
});
