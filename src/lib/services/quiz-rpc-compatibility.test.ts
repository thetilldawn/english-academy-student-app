import { describe, expect, it, vi } from "vitest";

import {
  answerQuizQuestionWithCompatibleRpc,
  type QuizRpc,
} from "./quiz-rpc-compatibility";

const parameters = {
  p_attempt_id: "attempt",
  p_choice_index: 1,
};

describe("quiz RPC deployment compatibility", () => {
  it("uses v3 when the current production function is available", async () => {
    const rpc = vi.fn<QuizRpc>().mockResolvedValue({
      data: { correct: true },
      error: null,
    });

    const result = await answerQuizQuestionWithCompatibleRpc(rpc, parameters);

    expect(result.data).toEqual({ correct: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("answer_quiz_question_v3", parameters);
  });

  it.each(["PGRST202", "42883"])(
    "falls back to v2 only when v3 is unavailable (%s)",
    async (code) => {
      const rpc = vi
        .fn<QuizRpc>()
        .mockResolvedValueOnce({
          data: null,
          error: {
            code,
            message: "Could not find answer_quiz_question_v3",
          },
        })
        .mockResolvedValueOnce({ data: { correct: true }, error: null });

      const result = await answerQuizQuestionWithCompatibleRpc(
        rpc,
        parameters,
      );

      expect(result.data).toEqual({ correct: true });
      expect(rpc).toHaveBeenNthCalledWith(
        2,
        "answer_quiz_question_v2",
        parameters,
      );
    },
  );

  it("does not hide a real v3 answer error", async () => {
    const rpc = vi.fn<QuizRpc>().mockResolvedValue({
      data: null,
      error: { code: "22023", message: "question_already_answered" },
    });

    const result = await answerQuizQuestionWithCompatibleRpc(rpc, parameters);

    expect(result.error?.code).toBe("22023");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
