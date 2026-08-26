import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  answerRpc: vi.fn(),
  materialize: vi.fn(),
  resumeRpc: vi.fn(),
  rpc: vi.fn(),
  startRetryRpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("../quiz-rpc-compatibility", () => ({
  answerQuizQuestionWithCompatibleRpc: mocks.answerRpc,
  resumeQuizAfterFeedbackWithCompatibleRpc: mocks.resumeRpc,
  startQuizRetryWithCompatibleRpc: mocks.startRetryRpc,
}));
vi.mock("../vocab-assignment-queue-command", () => ({
  materializeReadyVocabAssignmentQueue: mocks.materialize,
}));

import {
  answerStudentQuestion,
  expireStudentAttempt,
  timeoutStudentQuestion,
} from "./attempt-command";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.materialize.mockResolvedValue(null);
});

describe("quiz attempt completion commands", () => {
  it("materializes the next queued assignment after an explicit expiry", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await expireStudentAttempt("student-1", "attempt-1");

    expect(mocks.rpc).toHaveBeenCalledWith("expire_quiz_attempt", {
      p_attempt_id: "attempt-1",
      p_student_id: "student-1",
    });
    expect(mocks.materialize).toHaveBeenCalledOnce();
    expect(mocks.materialize).toHaveBeenCalledWith("student-1");
  });

  it("does not materialize a queue when explicit expiry fails", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "failed" },
    });

    await expect(
      expireStudentAttempt("student-1", "attempt-1"),
    ).rejects.toThrow("시험 종료상태를 저장하지 못했습니다.");
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("materializes once only when a submitted answer completes the attempt", async () => {
    mocks.answerRpc
      .mockResolvedValueOnce({
        data: { completed: false },
        error: null,
        feedbackProtocol: "variable",
      })
      .mockResolvedValueOnce({
        data: { completed: true },
        error: null,
        feedbackProtocol: "variable",
      });

    const input = {
      attemptId: "attempt-1",
      choiceIndex: 0,
      phase: "initial" as const,
      questionId: "question-1",
      studentId: "student-1",
    };
    await answerStudentQuestion(input);
    await answerStudentQuestion(input);

    expect(mocks.materialize).toHaveBeenCalledOnce();
  });

  it("materializes once when a timed-out answer completes the attempt", async () => {
    mocks.answerRpc.mockResolvedValue({
      data: { completed: true },
      error: null,
      feedbackProtocol: "variable",
    });

    await timeoutStudentQuestion({
      attemptId: "attempt-1",
      phase: "initial",
      questionId: "question-1",
      studentId: "student-1",
    });

    expect(mocks.materialize).toHaveBeenCalledOnce();
  });
});
