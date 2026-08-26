import {
  ANSWER_SERVER_FEEDBACK_RESERVATION_MS,
  quizAttemptUsesDeadlineClock,
} from "../domain/quiz-session";
import type { QuizAnswerResponse, QuizAttempt } from "../model";

export function previewNextQuestionMilliseconds(
  attempt: QuizAttempt,
  payload: QuizAnswerResponse,
) {
  if (!quizAttemptUsesDeadlineClock(attempt)) return 1_000;
  if (attempt.timingMode === "none") {
    return Math.max(0, payload.timerRemainingMilliseconds ?? 0);
  }
  if (
    attempt.timingMode === "per_question" &&
    attempt.questionTimeLimitSeconds
  ) {
    return attempt.questionTimeLimitSeconds * 1_000;
  }
  return Math.max(
    0,
    (payload.timerRemainingMilliseconds ?? 0) -
      (payload.feedbackProtocol === "legacy"
        ? 0
        : ANSWER_SERVER_FEEDBACK_RESERVATION_MS),
  );
}

export function activeNextQuestionMilliseconds(input: {
  activatedAt: number;
  attempt: QuizAttempt;
  previewMilliseconds: number;
  serverMilliseconds: number;
  serverReceivedAt: number;
}) {
  if (!quizAttemptUsesDeadlineClock(input.attempt)) return 1_000;
  const now = performance.now();
  const localRemaining = Math.max(
    0,
    input.previewMilliseconds - (now - input.activatedAt),
  );
  const serverRemaining = Math.max(
    0,
    input.serverMilliseconds - (now - input.serverReceivedAt),
  );
  if (
    input.attempt.timingMode === "per_question" &&
    input.attempt.questionTimeLimitSeconds
  ) {
    return Math.min(
      input.attempt.questionTimeLimitSeconds * 1_000,
      serverRemaining,
    );
  }
  return Math.min(localRemaining, serverRemaining);
}
