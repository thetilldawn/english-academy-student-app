"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch } from "react";

import { studentAppText } from "@/content/ko/student-app";

import { submitQuizAnswer } from "../api/quiz-attempt";
import {
  ANSWER_SELECTION_DELAY_MS,
  applyQuizAnswerTransition,
  quizAnswerAudioUrl,
  quizAnswerDisposition,
  quizAttemptUsesDeadlineClock,
} from "../domain/quiz-session";
import type {
  QuizPlayerAction,
  QuizPlayerState,
} from "../domain/quiz-player-state";
import type { QuizAttempt, QuizQuestion } from "../model";
import type {
  QuizAudioCompletion,
  TimedQuizAudioCompletion,
} from "./quiz-audio-element";
import {
  activeNextQuestionMilliseconds,
  previewNextQuestionMilliseconds,
} from "./quiz-transition-timer";
import { resolveQuizFeedbackTransition } from "./resolve-quiz-feedback-transition";
import { useQuizFeedbackInterruption } from "./use-quiz-feedback-interruption";

type PendingSubmission = {
  attemptId: string;
  choiceIndex: number | null;
  phase: "initial" | "retry";
  primed: boolean;
  promptAudioCompletion: Promise<TimedQuizAudioCompletion> | null;
  questionId: string;
  selectionVersion: number;
  notBefore: number;
};

type RunSubmissionInput = {
  attempt: QuizAttempt;
  choiceIndex: number | null;
  promptAudioCompletion: Promise<TimedQuizAudioCompletion> | null;
  question: QuizQuestion;
  primed?: boolean;
  submittedAt: number;
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export function useQuizSubmission(input: {
  canInterruptFeedbackAudio: () => boolean;
  cancelPendingPromptAudio: () => void;
  captureActivePromptAudio: () => Promise<TimedQuizAudioCompletion> | null;
  currentQuestion: QuizQuestion | null;
  deadlineSubmissionNotBeforeRef: { current: number };
  dispatch: Dispatch<QuizPlayerAction>;
  inFlightRequestRef: { current: string | null };
  mountedRef: { current: boolean };
  onResult: (attemptId: string) => void;
  playAnswerAudio: (audioUrl: string) => Promise<QuizAudioCompletion>;
  primeChoiceAudio: (audioUrl: string | null) => void;
  recoverFromServer: () => Promise<boolean>;
  resetClock: (remainingMilliseconds: number) => void;
  state: QuizPlayerState;
  stopFeedbackAudio: () => void;
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
        primed: pending.primed,
        promptAudioCompletion: current.captureActivePromptAudio() ?? pending.promptAudioCompletion,
        submittedAt: performance.now(),
      });
    }, Math.max(0, Math.ceil(pending.notBefore - performance.now())));
  }, [cancelPending, clearPendingTimer, hasPendingChoice]);
  const feedbackInterruption = useQuizFeedbackInterruption({
    canInterruptAudio: input.canInterruptFeedbackAudio,
    inFlightRequestRef: inFlightRequestRef,
    mountedRef: input.mountedRef,
    stopAudio: input.stopFeedbackAudio,
  });
  const { waitForAudio } = feedbackInterruption;

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

      input.cancelPendingPromptAudio();
      const answerAudioUrl = quizAnswerAudioUrl(
        submission.question,
        submission.choiceIndex,
        submission.attempt.quizContentMode,
      );
      if (!submission.primed) input.primeChoiceAudio(answerAudioUrl);
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
      const tryRecover = async () => {
        if (recoveryAttempted) return false;
        recoveryAttempted = true;
        cancelPending();
        input.dispatch({ type: "choice-pending", choiceIndex: null });
        return input.recoverFromServer();
      };

      try {
        const { ok, payload, receivedAt } = await submitQuizAnswer({
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
        const disposition = quizAnswerDisposition(payload, answeredPhase);
        const transition = await resolveQuizFeedbackTransition({
          answerAudioUrl,
          attemptId: submission.attempt.id,
          disposition,
          isActive: () =>
            input.mountedRef.current &&
            inFlightRequestRef.current === requestKey,
          payload,
          playAnswerAudio: input.playAnswerAudio,
          promptAudioCompletion: submission.promptAudioCompletion,
          receivedAt,
          submittedAt: submission.submittedAt,
          waitForAudio: (play) => waitForAudio(requestKey, play),
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

        const previewAttempt = applyQuizAnswerTransition({
          attempt: submission.attempt,
          answeredQuestionId: submission.question.id,
          answeredPhase,
          choiceIndex: submission.choiceIndex,
          payload,
          timerDeadlineAt: payload.questionDeadlineAt!,
        });
        const previewMilliseconds = previewNextQuestionMilliseconds(
          submission.attempt,
          payload,
        );
        const activatedAt = performance.now();
        input.resetClock(previewMilliseconds);
        input.dispatch({
          type: "feedback-transitioned",
          attempt: previewAttempt,
        });

        const synchronized = await transition.synchronization;
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

        const serverStartRemaining = Math.max(
          0,
          synchronized.payload.transitionRemainingMilliseconds -
            (performance.now() - synchronized.receivedAt),
        );
        if (serverStartRemaining > 0) {
          await wait(serverStartRemaining);
        }
        if (
          !input.mountedRef.current ||
          inFlightRequestRef.current !== requestKey
        ) {
          return;
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
          activatedAt,
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
          preservePendingChoice: true,
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
    [cancelPending, deadlineSubmissionNotBeforeRef, inFlightRequestRef, input, timeWarningAnnouncedRef, waitForAudio],
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
        (!input.state.transitionPending && inFlightRequestRef.current !== null) ||
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
          promptAudioCompletion: input.captureActivePromptAudio(),
          question,
          submittedAt: performance.now(),
        });
        return;
      }

      const previous = hasPendingChoice() ? pendingSubmissionRef.current : null;
      const promptAudioCompletion = previous
        ? previous.promptAudioCompletion
        : input.captureActivePromptAudio();
      input.cancelPendingPromptAudio();
      const answerAudioUrl = quizAnswerAudioUrl(question, choiceIndex, input.state.attempt.quizContentMode);
      input.primeChoiceAudio(answerAudioUrl);
      pendingSubmissionRef.current = {
        attemptId: input.state.attempt.id,
        questionId: question.id,
        phase,
        selectionVersion: input.state.selectionVersion,
        choiceIndex,
        primed: Boolean(answerAudioUrl),
        promptAudioCompletion,
        notBefore: performance.now() + (choiceIndex === null ? 0 : ANSWER_SELECTION_DELAY_MS),
      };
      input.dispatch({ type: "choice-pending", choiceIndex });
      schedulePending();
    },
    [hasPendingChoice, inFlightRequestRef, input, runSubmission, schedulePending],
  );
  return {
    canInterruptFeedback: feedbackInterruption.canInterrupt,
    hasPendingChoice,
    interruptFeedback: feedbackInterruption.interrupt,
    submitChoice,
  };
}
