"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch } from "react";

import { studentAppText } from "@/content/ko/student-app";

import { submitQuizAnswer } from "../api/quiz-attempt";
import type { QuizTransport } from "../api/quiz-transport";
import {
  ANSWER_SELECTION_DELAY_MS,
  ANSWER_RESULT_VISIBLE_MS,
  applyQuizAnswerTransition,
  recoveredQuizAnswerFeedback,
  quizAnswerDisposition,
  quizAttemptUsesDeadlineClock,
} from "../domain/quiz-session";
import type {
  QuizPlayerAction,
  QuizPlayerState,
} from "../domain/quiz-player-state";
import type { QuizAttempt, QuizQuestion } from "../model";
import type { BeforeQuizRestore } from "./use-quiz-recovery";
import {
  activeNextQuestionMilliseconds,
  previewNextQuestionMilliseconds,
} from "./quiz-transition-timer";
import { resolveQuizFeedbackTransition } from "./resolve-quiz-feedback-transition";

type PendingSubmission = {
  attemptId: string;
  choiceIndex: number | null;
  phase: "initial" | "retry";
  questionId: string;
  selectionVersion: number;
  notBefore: number;
};

type RunSubmissionInput = {
  attempt: QuizAttempt;
  choiceIndex: number | null;
  question: QuizQuestion;
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export function useQuizSubmission(input: {
  transport?: QuizTransport;
  currentQuestion: QuizQuestion | null;
  deadlineSubmissionNotBeforeRef: { current: number };
  dispatch: Dispatch<QuizPlayerAction>;
  inFlightRequestRef: { current: string | null };
  mountedRef: { current: boolean };
  onResult: (attemptId: string) => void;
  recoverFromServer: (beforeRestore?: BeforeQuizRestore) => Promise<boolean>;
  resetClock: (remainingMilliseconds: number) => void;
  state: QuizPlayerState;
  stopAudio: () => void;
  timeWarningAnnouncedRef: { current: boolean };
}) {
  const { inFlightRequestRef, deadlineSubmissionNotBeforeRef, timeWarningAnnouncedRef } = input;
  const pendingSubmissionRef = useRef<PendingSubmission | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  const latestInputRef = useRef(input);
  const runSubmissionRef = useRef<((submission: RunSubmissionInput) => Promise<void>) | null>(null);
  useLayoutEffect(() => {
    latestInputRef.current = input;
  });

  const clearPendingTimer = useCallback(() => {
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, []);
  const cancelPending = useCallback(() => {
    clearPendingTimer();
    pendingSubmissionRef.current = null;
  }, [clearPendingTimer]);
  const hasPendingChoice = useCallback(() => {
    const pending = pendingSubmissionRef.current;
    const current = latestInputRef.current;
    return Boolean(
      pending &&
      current.mountedRef.current &&
      current.state.attempt.status === "in_progress" &&
      pending.attemptId === current.state.attempt.id &&
      pending.phase === current.state.attempt.phase &&
      pending.questionId === current.currentQuestion?.id &&
      pending.selectionVersion === current.state.selectionVersion,
    );
  }, []);
  const schedulePending = useCallback(() => {
    clearPendingTimer();
    const pending = pendingSubmissionRef.current;
    if (!pending) return;
    pendingTimerRef.current = window.setTimeout(() => {
      pendingTimerRef.current = null;
      if (!hasPendingChoice()) {
        cancelPending();
        return;
      }
      const current = latestInputRef.current;
      if (
        !current.state.timerSynchronized ||
        current.state.transitionPending ||
        current.state.submitting ||
        current.state.feedback !== null ||
        current.inFlightRequestRef.current !== null ||
        !current.currentQuestion
      ) {
        // Readiness changes re-arm the same deadline; they do not restart the selection delay.
        return;
      }
      pendingSubmissionRef.current = null;
      void runSubmissionRef.current?.({
        attempt: current.state.attempt,
        question: current.currentQuestion,
        choiceIndex: pending.choiceIndex,
      });
    }, Math.max(0, Math.ceil(pending.notBefore - performance.now())));
  }, [cancelPending, clearPendingTimer, hasPendingChoice]);

  useEffect(() => cancelPending, [cancelPending]);
  useEffect(() => {
    if (!hasPendingChoice()) cancelPending();
    else schedulePending();
  }, [
    cancelPending,
    hasPendingChoice,
    schedulePending,
    input.currentQuestion?.id,
    input.state.attempt.id,
    input.state.attempt.phase,
    input.state.attempt.status,
    input.state.selectionVersion,
    input.state.timerSynchronized,
    input.state.transitionPending,
    input.state.submitting,
    input.state.feedback,
  ]);

  const runSubmission = useCallback(
    async function run(submission: RunSubmissionInput): Promise<void> {
      const answeredPhase = submission.attempt.phase;
      if (answeredPhase !== "initial" && answeredPhase !== "retry") return;

      input.stopAudio();
      const requestKey = [
        submission.attempt.id,
        answeredPhase,
        submission.question.id,
      ].join(":");
      inFlightRequestRef.current = requestKey;
      input.dispatch({
        type: "submission-started",
        phase: answeredPhase,
        choiceIndex: submission.choiceIndex,
      });
      let recoveryAttempted = false;
      let answerReceived = false;
      const tryRecover = async () => {
        if (recoveryAttempted) return false;
        recoveryAttempted = true;
        cancelPending();
        input.dispatch({ type: "choice-pending", choiceIndex: null });
        return input.recoverFromServer(async (attempt) => {
          const isActive = () => input.mountedRef.current &&
            inFlightRequestRef.current === requestKey;
          if (!isActive()) return false;
          if (!answerReceived && attempt.id === submission.attempt.id) {
            const feedback = recoveredQuizAnswerFeedback({
              attempt, questionId: submission.question.id,
              phase: answeredPhase, choiceIndex: submission.choiceIndex,
            });
            if (feedback) {
              answerReceived = true;
              input.dispatch({ type: "answer-received", payload: feedback });
              await wait(ANSWER_RESULT_VISIBLE_MS);
            }
          }
          return isActive();
        });
      };

      try {
        const { ok, payload, receivedAt } = await (input.transport?.answer ?? submitQuizAnswer)({
          attemptId: submission.attempt.id,
          questionId: submission.question.id,
          phase: answeredPhase,
          choiceIndex: submission.choiceIndex,
        });
        if (
          !input.mountedRef.current ||
          inFlightRequestRef.current !== requestKey
        ) {
          return;
        }
        if (!ok) {
          if (await tryRecover()) return;
          throw new Error(payload.error ?? studentAppText.attempt.saveError);
        }
        if (payload.expired) {
          inFlightRequestRef.current = null;
          input.onResult(submission.attempt.id);
          return;
        }

        input.dispatch({ type: "answer-received", payload });
        answerReceived = true;
        const disposition = quizAnswerDisposition(payload, answeredPhase);
        const transition = await resolveQuizFeedbackTransition({
          resume: input.transport?.feedback,
          attemptId: submission.attempt.id,
          disposition,
          isActive: () =>
            input.mountedRef.current &&
            inFlightRequestRef.current === requestKey,
          payload,
          receivedAt,
          questionTimeLimitSeconds: submission.attempt.timingMode === "per_question"
            ? submission.attempt.questionTimeLimitSeconds : null,
        });
        if (
          !input.mountedRef.current ||
          inFlightRequestRef.current !== requestKey
        ) {
          return;
        }
        if (disposition === "result") {
          inFlightRequestRef.current = null;
          input.onResult(submission.attempt.id);
          return;
        }
        if (disposition === "recover" || !transition.synchronization) {
          if (await tryRecover()) return;
          throw new Error(studentAppText.attempt.stateError);
        }

        const previewMilliseconds = previewNextQuestionMilliseconds(
          submission.attempt,
          payload,
        );
        if (!transition.ready && !transition.quietReservation) {
          cancelPending();
          input.dispatch({ type: "next-question-preparing" });
        }
        const synchronized = transition.ready ?? await transition.synchronization;
        if (
          !input.mountedRef.current ||
          inFlightRequestRef.current !== requestKey
        ) {
          return;
        }
        if (synchronized.recoverFromServer) {
          if (await tryRecover()) return;
          throw new Error(studentAppText.attempt.stateError);
        }

        const synchronizedAttempt = applyQuizAnswerTransition({
          attempt: submission.attempt,
          answeredQuestionId: submission.question.id,
          answeredPhase,
          choiceIndex: submission.choiceIndex,
          payload: synchronized.payload,
          timerDeadlineAt: synchronized.payload.questionDeadlineAt!,
        });
        const activeMilliseconds = activeNextQuestionMilliseconds({
          activatedAt: performance.now(),
          attempt: synchronizedAttempt,
          previewMilliseconds,
          serverMilliseconds:
            synchronized.payload.timerRemainingMilliseconds!,
          serverReceivedAt: synchronized.receivedAt,
        });
        inFlightRequestRef.current = null;
        deadlineSubmissionNotBeforeRef.current = 0;
        input.resetClock(activeMilliseconds);
        input.dispatch({
          type: "attempt-replaced",
          attempt: synchronizedAttempt,
          remainingSeconds: Math.ceil(activeMilliseconds / 1_000),
        });
        timeWarningAnnouncedRef.current = false;

      } catch (requestError) {
        cancelPending();
        if (await tryRecover()) return;
        if (!input.mountedRef.current) return;
        inFlightRequestRef.current = null;
        input.dispatch({
          type: "submission-failed",
          message:
            requestError instanceof Error
              ? requestError.message
              : studentAppText.attempt.saveError,
        });
      }
    },
    [cancelPending, deadlineSubmissionNotBeforeRef, inFlightRequestRef, input, timeWarningAnnouncedRef],
  );

  useLayoutEffect(() => {
    runSubmissionRef.current = runSubmission;
  }, [runSubmission]);

  const submitChoice = useCallback(
    (choiceIndex: number | null) => {
      const question = input.currentQuestion;
      const phase = input.state.attempt.phase;
      if (
        !question ||
        input.state.attempt.status !== "in_progress" ||
        (phase !== "initial" && phase !== "retry") ||
        (choiceIndex !== null && (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= question.choices.length)) ||
        (choiceIndex !== null &&
          quizAttemptUsesDeadlineClock(input.state.attempt) &&
          input.state.remainingSeconds === 0)
      ) {
        return;
      }

      if (
        !input.state.timerSynchronized ||
        input.state.transitionPending ||
        inFlightRequestRef.current !== null ||
        input.state.submitting ||
        input.state.feedback !== null
      ) {
        return;
      }
      if (choiceIndex === null && hasPendingChoice()) return;
      if (choiceIndex === null && !input.state.transitionPending) {
        void runSubmission({
          attempt: input.state.attempt,
          choiceIndex,
          question,
        });
        return;
      }

      input.stopAudio();
      pendingSubmissionRef.current = {
        attemptId: input.state.attempt.id,
        questionId: question.id,
        phase,
        selectionVersion: input.state.selectionVersion,
        choiceIndex,
        notBefore: performance.now() + (choiceIndex === null ? 0 : ANSWER_SELECTION_DELAY_MS),
      };
      input.dispatch({ type: "choice-pending", choiceIndex });
      schedulePending();
    },
    [hasPendingChoice, inFlightRequestRef, input, runSubmission, schedulePending],
  );
  return {
    hasPendingChoice,
    submitChoice,
  };
}
