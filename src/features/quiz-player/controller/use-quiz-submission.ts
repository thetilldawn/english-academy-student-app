"use client";

import { useCallback, useEffect, useRef, type Dispatch } from "react";

import { studentAppText } from "@/content/ko/student-app";

import { submitQuizAnswer } from "../api/quiz-attempt";
import {
  applyQuizAnswerTransition,
  quizAnswerAudioUrl,
  quizAnswerDisposition,
} from "../domain/quiz-session";
import type {
  QuizPlayerAction,
  QuizPlayerState,
} from "../domain/quiz-player-state";
import type { QuizAttempt, QuizQuestion } from "../model";
import type { QuizAudioCompletion } from "./quiz-audio-element";
import {
  activeNextQuestionMilliseconds,
  previewNextQuestionMilliseconds,
} from "./quiz-transition-timer";
import { resolveQuizFeedbackTransition } from "./resolve-quiz-feedback-transition";

type QueuedSubmission = {
  attemptId: string;
  choiceIndex: number | null;
  phase: "initial" | "retry";
  primed: boolean;
  questionId: string;
  submittedAt: number;
};

type RunSubmissionInput = {
  attempt: QuizAttempt;
  choiceIndex: number | null;
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
  cancelPendingPromptAudio: () => void;
  currentQuestion: QuizQuestion | null;
  dispatch: Dispatch<QuizPlayerAction>;
  inFlightRequestRef: { current: string | null };
  mountedRef: { current: boolean };
  onResult: (attemptId: string) => void;
  playAnswerAudio: (audioUrl: string) => Promise<QuizAudioCompletion>;
  primeChoiceAudio: (audioUrl: string | null) => void;
  recoverFromServer: () => Promise<boolean>;
  resetClock: (remainingMilliseconds: number) => void;
  state: QuizPlayerState;
  timeWarningAnnouncedRef: { current: boolean };
}) {
  const queuedSubmissionRef = useRef<QueuedSubmission | null>(null);

  useEffect(
    () => () => {
      queuedSubmissionRef.current = null;
    },
    [],
  );

  const runSubmission = useCallback(
    async function run(submission: RunSubmissionInput): Promise<void> {
      const answeredPhase = submission.attempt.phase;
      if (answeredPhase !== "initial" && answeredPhase !== "retry") return;

      input.cancelPendingPromptAudio();
      const answerAudioUrl = quizAnswerAudioUrl(
        submission.question,
        submission.choiceIndex,
      );
      if (!submission.primed) input.primeChoiceAudio(answerAudioUrl);
      const requestKey = [
        submission.attempt.id,
        answeredPhase,
        submission.question.id,
      ].join(":");
      input.inFlightRequestRef.current = requestKey;
      input.dispatch({
        type: "submission-started",
        phase: answeredPhase,
        choiceIndex: submission.choiceIndex,
      });
      let recoveryAttempted = false;
      const tryRecover = async () => {
        if (recoveryAttempted) return false;
        recoveryAttempted = true;
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
          input.inFlightRequestRef.current !== requestKey
        ) {
          return;
        }
        if (!ok) {
          if (await tryRecover()) return;
          throw new Error(payload.error ?? studentAppText.attempt.saveError);
        }
        if (payload.expired) {
          input.inFlightRequestRef.current = null;
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
            input.inFlightRequestRef.current === requestKey,
          payload,
          playAnswerAudio: input.playAnswerAudio,
          receivedAt,
          submittedAt: submission.submittedAt,
        });
        if (
          !input.mountedRef.current ||
          input.inFlightRequestRef.current !== requestKey
        ) {
          return;
        }
        if (disposition === "result") {
          input.inFlightRequestRef.current = null;
          input.onResult(submission.attempt.id);
          return;
        }
        if (disposition === "recover" || !transition.synchronization) {
          queuedSubmissionRef.current = null;
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
          input.inFlightRequestRef.current !== requestKey
        ) {
          return;
        }
        if (synchronized.recoverFromServer) {
          queuedSubmissionRef.current = null;
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
          input.inFlightRequestRef.current !== requestKey
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
        const queued = queuedSubmissionRef.current;
        const nextQuestion = synchronizedAttempt.questions.find(
          (question) => question.id === synchronizedAttempt.currentQuestionId,
        );
        const canSubmitQueued =
          queued &&
          nextQuestion &&
          queued.attemptId === synchronizedAttempt.id &&
          queued.phase === synchronizedAttempt.phase &&
          queued.questionId === nextQuestion.id;

        queuedSubmissionRef.current = null;
        input.inFlightRequestRef.current = null;
        input.resetClock(activeMilliseconds);
        input.dispatch({
          type: "attempt-replaced",
          attempt: synchronizedAttempt,
          remainingSeconds: Math.ceil(activeMilliseconds / 1_000),
        });
        input.timeWarningAnnouncedRef.current = false;

        if (canSubmitQueued) {
          void run({
            attempt: synchronizedAttempt,
            choiceIndex: queued.choiceIndex,
            question: nextQuestion,
            primed: queued.primed,
            submittedAt: queued.submittedAt,
          });
        }
      } catch (requestError) {
        queuedSubmissionRef.current = null;
        if (await tryRecover()) return;
        if (!input.mountedRef.current) return;
        input.inFlightRequestRef.current = null;
        input.dispatch({
          type: "submission-failed",
          message:
            requestError instanceof Error
              ? requestError.message
              : studentAppText.attempt.saveError,
        });
      }
    },
    [input],
  );

  return useCallback(
    (choiceIndex: number | null) => {
      const question = input.currentQuestion;
      const phase = input.state.attempt.phase;
      if (
        !question ||
        (phase !== "initial" && phase !== "retry") ||
        (choiceIndex !== null && input.state.remainingSeconds === 0)
      ) {
        return;
      }

      if (input.state.transitionPending) {
        if (
          queuedSubmissionRef.current ||
          input.state.submitting ||
          input.state.feedback !== null
        ) {
          return;
        }
        input.cancelPendingPromptAudio();
        const answerAudioUrl = quizAnswerAudioUrl(question, choiceIndex);
        input.primeChoiceAudio(answerAudioUrl);
        queuedSubmissionRef.current = {
          attemptId: input.state.attempt.id,
          choiceIndex,
          phase,
          primed: Boolean(answerAudioUrl),
          questionId: question.id,
          submittedAt: performance.now(),
        };
        input.dispatch({
          type: "transition-choice-queued",
          phase,
          choiceIndex,
        });
        return;
      }

      if (
        !input.state.timerSynchronized ||
        input.inFlightRequestRef.current !== null ||
        input.state.submitting ||
        input.state.feedback !== null
      ) {
        return;
      }
      void runSubmission({
        attempt: input.state.attempt,
        choiceIndex,
        question,
        submittedAt: performance.now(),
      });
    },
    [input, runSubmission],
  );
}
