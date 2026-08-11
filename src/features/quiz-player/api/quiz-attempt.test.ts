// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { submitQuizAnswer } from "./quiz-attempt";

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
});
