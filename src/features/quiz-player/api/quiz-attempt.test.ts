// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { resumeQuizAfterFeedback, submitQuizAnswer } from "./quiz-attempt";

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
});

describe("quiz attempt transport", () => {
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
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/student/attempts/attempt-1/feedback",
      expect.objectContaining({
        body: JSON.stringify({
          nextPhase: "initial",
          nextQuestionId: "question-2",
        }),
        method: "POST",
      }),
    );
  });
});
