import { describe, expect, it, vi } from "vitest";

import {
  answerQuizQuestionWithCompatibleRpc,
  resumeQuizAfterFeedbackWithCompatibleRpc,
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
    expect(result.feedbackProtocol).toBe("variable");
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
      expect(result.feedbackProtocol).toBe("legacy");
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
    expect(result.feedbackProtocol).toBe("variable");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not fall back when a missing-function code has no matching function name", async () => {
    const rpc = vi.fn<QuizRpc>().mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "schema cache unavailable" },
    });

    const result = await answerQuizQuestionWithCompatibleRpc(rpc, parameters);

    expect(result.feedbackProtocol).toBe("variable");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("falls back to fixed-audio resume while resume v2 is being deployed", async () => {
    const resumeParameters = {
      p_student_id: "student-1",
      p_attempt_id: "attempt-1",
      p_next_question_id: "question-2",
      p_next_phase: "initial",
      p_transition_remaining_milliseconds: 150,
    };
    const rpc = vi
      .fn<QuizRpc>()
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "PGRST202",
          message: "resume_quiz_after_feedback_v2 is not in the schema cache",
        },
      })
      .mockResolvedValueOnce({
        data: { questionStartsAt: "2026-08-15T00:00:00.150Z" },
        error: null,
      });
    const pause = vi.fn().mockResolvedValue(undefined);

    const result = await resumeQuizAfterFeedbackWithCompatibleRpc(
      rpc,
      resumeParameters,
      pause,
    );

    expect(result.error).toBeNull();
    expect(pause).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "resume_quiz_after_feedback_v2",
      resumeParameters,
    );
    expect(rpc).toHaveBeenNthCalledWith(2, "resume_quiz_after_feedback_v1", {
      p_student_id: "student-1",
      p_attempt_id: "attempt-1",
      p_next_question_id: "question-2",
      p_next_phase: "initial",
    });
  });

  it("aligns a 750ms client transition with resume v1's final 150ms", async () => {
    const rpc = vi
      .fn<QuizRpc>()
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "PGRST202",
          message: "resume_quiz_after_feedback_v2 is not in the schema cache",
        },
      })
      .mockResolvedValueOnce({
        data: { questionStartsAt: "2026-08-15T00:00:00.750Z" },
        error: null,
      });
    const pause = vi.fn().mockResolvedValue(undefined);

    await resumeQuizAfterFeedbackWithCompatibleRpc(
      rpc,
      { p_transition_remaining_milliseconds: 750 },
      pause,
    );

    expect(pause).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledWith(600);
  });

  it("retries resume v2 when the 7-second schema refresh makes v1 invalid", async () => {
    const missingV2 = {
      data: null,
      error: {
        code: "PGRST202",
        message: "resume_quiz_after_feedback_v2 is not in the schema cache",
      },
    };
    const rpc = vi
      .fn<QuizRpc>()
      .mockResolvedValueOnce(missingV2)
      .mockResolvedValueOnce({
        data: null,
        error: { code: "22023", message: "feedback_window_invalid" },
      })
      .mockResolvedValueOnce(missingV2)
      .mockResolvedValueOnce({
        data: { questionStartsAt: "2026-08-15T00:00:00.750Z" },
        error: null,
      });
    const pause = vi.fn().mockResolvedValue(undefined);

    const result = await resumeQuizAfterFeedbackWithCompatibleRpc(
      rpc,
      { p_transition_remaining_milliseconds: 750 },
      pause,
    );

    expect(result.error).toBeNull();
    expect(pause.mock.calls).toEqual([[600], [250], [250]]);
    expect(rpc).toHaveBeenCalledTimes(4);
  });

  it("does not hide a resume v2 domain error", async () => {
    const rpc = vi.fn<QuizRpc>().mockResolvedValue({
      data: null,
      error: { code: "22023", message: "next_question_mismatch" },
    });

    const result = await resumeQuizAfterFeedbackWithCompatibleRpc(rpc, {
      p_transition_remaining_milliseconds: 150,
    });

    expect(result.error?.code).toBe("22023");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
