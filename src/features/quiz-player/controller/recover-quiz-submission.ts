import type { Dispatch } from "react";
import type { QuizTransport } from "../api/quiz-transport";
import { recoveredQuizAnswerFeedback, quizResultIsConfirmed } from "../domain/quiz-session";
import type { QuizPlayerAction } from "../domain/quiz-player-state";
import type { QuizAnswerResponse } from "../model";
import { resolveQuizFeedbackTransition } from "./resolve-quiz-feedback-transition";
import type { QuizRecoverySnapshot } from "./use-quiz-recovery";

export async function recoverQuizSubmission(input: {
  snapshot: QuizRecoverySnapshot;
  transport: QuizTransport;
  dispatch: Dispatch<QuizPlayerAction>;
  questionId: string;
  phase: "initial" | "retry";
  choiceIndex: number | null;
  isActive: () => boolean;
  showFeedback: (feedback: QuizAnswerResponse) => number;
}): Promise<QuizRecoverySnapshot | null> {
  let snapshot = input.snapshot;
  // One fresh confirmation is allowed if the acknowledgement response is lost.
  for (let confirmation = 0; confirmation < 2; confirmation += 1) {
    if (!input.isActive()) return null;
    const { attempt } = snapshot.payload;
    const feedback = recoveredQuizAnswerFeedback({ attempt, ...input });
    if (!feedback) return null;
    const visibleUntil = input.showFeedback(feedback);
    const terminal = attempt.status !== "in_progress" || attempt.phase === "review" || attempt.phase === "completed";
    if (terminal) {
      if (!quizResultIsConfirmed(snapshot.payload)) return null;
      const remaining = Math.max(0, visibleUntil - performance.now());
      if (remaining > 0) await new Promise<void>(resolve => setTimeout(resolve, remaining));
      return input.isActive() ? snapshot : null;
    }
    if (!attempt.currentQuestionId || (attempt.phase !== "initial" && attempt.phase !== "retry")) {
      if (confirmation === 1) return null;
      const latest = await input.transport.read(attempt.id);
      if (!input.isActive() || !latest.ok || latest.payload.attempt.id !== attempt.id) return null;
      snapshot = latest;
      continue;
    }
    // The legacy GET reads attempt and questions separately. Even a zero
    // reservation can pair old timing with a newly stored answer; confirm it.
    const transition = await resolveQuizFeedbackTransition({
      resume: input.transport.feedback,
      attemptId: attempt.id,
      disposition: "next-question",
      isActive: input.isActive,
      receivedAt: snapshot.receivedAt,
      feedbackVisibleUntil: visibleUntil,
      payload: { ...feedback, feedbackProtocol: "variable", nextQuestionId: attempt.currentQuestionId,
        nextPhase: attempt.phase, questionDeadlineAt: attempt.timerDeadlineAt,
        timerRemainingMilliseconds: snapshot.payload.timerRemainingMilliseconds },
    });
    if (!input.isActive()) return null;
    if (!transition.ready && !transition.quietReservation) input.dispatch({ type: "next-question-preparing" });
    const synchronized = transition.ready ?? await transition.synchronization;
    if (!input.isActive()) return null;
    if (synchronized && !synchronized.recoverFromServer && synchronized.payload.questionDeadlineAt &&
        typeof synchronized.payload.timerRemainingMilliseconds === "number") {
      const deadline = synchronized.payload.questionDeadlineAt;
      return { receivedAt: synchronized.receivedAt, payload: {
        ...snapshot.payload,
        attempt: { ...attempt, timerDeadlineAt: deadline,
          ...(attempt.timingMode === "total" ? { deadlineAt: deadline } : {}) },
        timerRemainingMilliseconds: synchronized.payload.timerRemainingMilliseconds,
        transitionRemainingMilliseconds: synchronized.payload.transitionRemainingMilliseconds,
      } };
    }
    if (confirmation === 1) return null;
    const latest = await input.transport.read(attempt.id);
    if (!input.isActive() || !latest.ok || latest.payload.attempt.id !== attempt.id) return null;
    snapshot = latest;
  }
  return null;
}
