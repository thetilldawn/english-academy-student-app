"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch } from "react";

import { studentAppText } from "@/content/ko/student-app";

import { regularQuizTransport, type QuizTransport } from "../api/quiz-transport";
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
import type { QuizAnswerResponse, QuizAttempt, QuizQuestion } from "../model";
import type { BeforeQuizRestore, QuizRecoverySnapshot } from "./use-quiz-recovery";
import {
  activeNextQuestionMilliseconds,
  previewNextQuestionMilliseconds,
} from "./quiz-transition-timer";
import { resolveQuizFeedbackTransition } from "./resolve-quiz-feedback-transition";
import { observeQuizAnswer } from "./observe-quiz-answer";
import { recoverQuizSubmission } from "./recover-quiz-submission";

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
  recoverOnly?: boolean;
  feedbackVisibleUntil?: number;
  retryable?: boolean;
};

class QuizSubmissionFailure extends Error {}

export function useQuizSubmission(input: {
  transport?: QuizTransport;
  currentQuestion: QuizQuestion | null;
  deadlineSubmissionNotBeforeRef: { current: number };
  dispatch: Dispatch<QuizPlayerAction>;
  inFlightRequestRef: { current: string | null };
  mountedRef: { current: boolean };
  onResult: (attemptId: string) => void;
  recoverFromServer: (beforeRestore?: BeforeQuizRestore, confirmed?: QuizRecoverySnapshot) => Promise<boolean>;
  resetClock: (remainingMilliseconds: number) => void;
  state: QuizPlayerState;
  stopAudio: () => void;
  timeWarningAnnouncedRef: { current: boolean };
}) {
  const { inFlightRequestRef, deadlineSubmissionNotBeforeRef, timeWarningAnnouncedRef } = input;
  const pendingSubmissionRef = useRef<PendingSubmission | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  const requestSerial = useRef(0);
  const generation = useRef(0);
  const ownedRequest = useRef<string | null>(null);
  const unconfirmedSubmission = useRef<RunSubmissionInput | null>(null);
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
  useLayoutEffect(() => () => {
    generation.current += 1;
    if (inFlightRequestRef.current === ownedRequest.current) inFlightRequestRef.current = null;
    ownedRequest.current = null;
    unconfirmedSubmission.current = null;
    cancelPending();
  }, [input.state.attempt.id, input.transport, inFlightRequestRef, cancelPending]);
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
      if (latestInputRef.current.state.attempt.id !== submission.attempt.id ||
          latestInputRef.current.transport !== input.transport) return;
      const version = generation.current;

      input.stopAudio();
      const requestKey = [
        submission.attempt.id,
        answeredPhase,
        submission.question.id,
        ++requestSerial.current,
      ].join(":");
      inFlightRequestRef.current = requestKey;
      ownedRequest.current = requestKey;
      unconfirmedSubmission.current = submission;
      const isActive = () => input.mountedRef.current && generation.current === version &&
        inFlightRequestRef.current === requestKey;
      const transport = input.transport ?? regularQuizTransport;
      input.dispatch({
        type: "submission-started",
        phase: answeredPhase,
        choiceIndex: submission.choiceIndex,
      });
      let recoveryAttempted = false;
      let confirmedUnanswered = false;
      let feedbackVisibleUntil: number | null = submission.feedbackVisibleUntil ?? null;
      const showFeedback = (payload: QuizAnswerResponse) => {
        if (feedbackVisibleUntil === null) {
          input.dispatch({ type: "answer-received", payload });
          feedbackVisibleUntil = performance.now() + ANSWER_RESULT_VISIBLE_MS;
          submission.feedbackVisibleUntil = feedbackVisibleUntil;
        }
        return feedbackVisibleUntil;
      };
      const savedFeedback = (attempt: QuizAttempt) => attempt.id === submission.attempt.id
        ? recoveredQuizAnswerFeedback({ attempt, questionId: submission.question.id,
            phase: answeredPhase, choiceIndex: submission.choiceIndex }) : null;
      const tryRecover = async (confirmed?: QuizRecoverySnapshot) => {
        if (!isActive()) return true;
        if (recoveryAttempted) return false;
        recoveryAttempted = true;
        cancelPending();
        const recovered = await input.recoverFromServer(snapshot => {
          const attempt = snapshot.payload.attempt;
          const question = attempt.questions.find(value => value.id === submission.question.id);
          confirmedUnanswered = attempt.id === submission.attempt.id && attempt.phase === answeredPhase &&
            attempt.status === "in_progress" && attempt.currentQuestionId === submission.question.id && Boolean(question) &&
            (answeredPhase === "initial" ? question!.initialIsCorrect === null : question!.retryIsCorrect === null);
          return recoverQuizSubmission({
          snapshot, transport, dispatch: input.dispatch,
          questionId: submission.question.id, phase: answeredPhase, choiceIndex: submission.choiceIndex,
          isActive: () => isActive() && snapshot.isCurrent(), showFeedback,
          });
        }, confirmed);
        if (recovered && unconfirmedSubmission.current === submission) unconfirmedSubmission.current = null;
        return recovered;
      };

      try {
        if (submission.recoverOnly) {
          if (await tryRecover()) return;
          if (!isActive() || !submission.retryable || !confirmedUnanswered) throw new QuizSubmissionFailure(studentAppText.attempt.saveError);
          recoveryAttempted = false;
        }
        submission.retryable = false;
        const observed = await observeQuizAnswer({
          answer: () => transport.answer({ attemptId: submission.attempt.id,
            questionId: submission.question.id, phase: answeredPhase, choiceIndex: submission.choiceIndex }),
          read: () => transport.read(submission.attempt.id),
          isSaved: attempt => Boolean(savedFeedback(attempt)), isActive,
          onSlow: () => input.dispatch({ type: "submission-slow" }),
        });
        if (!isActive()) return;
        if (observed.kind === "recovered") {
          if (await tryRecover(observed.snapshot)) return;
          throw new QuizSubmissionFailure(studentAppText.attempt.stateError);
        }
        const { ok, payload, receivedAt } = observed.response;
        if (!isActive()) {
          return;
        }
        if (!ok) {
          submission.retryable = payload.retryable === true && payload.outcome === "not_applied";
          if (await tryRecover()) return;
          throw new QuizSubmissionFailure(payload.error ?? studentAppText.attempt.saveError);
        }
        if (payload.expired) {
          unconfirmedSubmission.current = null;
          inFlightRequestRef.current = null;
          input.onResult(submission.attempt.id);
          return;
        }

        showFeedback(payload);
        const disposition = quizAnswerDisposition(payload, answeredPhase);
        const transition = await resolveQuizFeedbackTransition({
          resume: input.transport?.feedback,
          attemptId: submission.attempt.id,
          disposition,
          isActive,
          payload,
          receivedAt,
          questionTimeLimitSeconds: submission.attempt.timingMode === "per_question"
            ? submission.attempt.questionTimeLimitSeconds : null,
          feedbackVisibleUntil: feedbackVisibleUntil!,
        });
        if (!isActive()) {
          return;
        }
        if (disposition === "result") {
          unconfirmedSubmission.current = null;
          inFlightRequestRef.current = null;
          input.onResult(submission.attempt.id);
          return;
        }
        if (disposition === "recover" || !transition.synchronization) {
          if (await tryRecover()) return;
          throw new QuizSubmissionFailure(studentAppText.attempt.stateError);
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
        if (!isActive()) {
          return;
        }
        if (synchronized.recoverFromServer) {
          if (await tryRecover()) return;
          throw new QuizSubmissionFailure(studentAppText.attempt.stateError);
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
        unconfirmedSubmission.current = null;
        deadlineSubmissionNotBeforeRef.current = 0;
        input.resetClock(activeMilliseconds);
        input.dispatch({
          type: "attempt-replaced",
          attempt: synchronizedAttempt,
          remainingSeconds: Math.ceil(activeMilliseconds / 1_000),
        });
        timeWarningAnnouncedRef.current = false;

      } catch (requestError) {
        if (!isActive()) return;
        cancelPending();
        if (await tryRecover()) return;
        if (!isActive()) return;
        inFlightRequestRef.current = null;
        input.dispatch({
          type: "submission-failed",
          preserveChoice: submission.choiceIndex,
          message:
            requestError instanceof QuizSubmissionFailure
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
  const retryPendingRecovery = useCallback(() => {
    const submission = unconfirmedSubmission.current;
    if (!submission || submission.attempt.id !== latestInputRef.current.state.attempt.id) return false;
    if (!inFlightRequestRef.current) void runSubmissionRef.current?.({ ...submission, recoverOnly: true });
    return true;
  }, [inFlightRequestRef]);

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
    retryPendingRecovery,
    submitChoice,
  };
}
