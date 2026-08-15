"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef } from "react";

import { studentAppText } from "@/content/ko/student-app";
import { getPriorWrongIndicator } from "@/lib/quiz/prior-wrong";

import {
  expireQuizAttempt,
  submitQuizAnswer,
} from "../api/quiz-attempt";
import {
  applyQuizAnswerTransition,
  quizAnswerAudioUrl,
  quizAnswerAnnouncement,
  quizAnswerDisposition,
  quizAudioPresentation,
  quizPreloadAudioUrls,
} from "../domain/quiz-session";
import {
  createQuizPlayerState,
  quizPlayerReducer,
} from "../domain/quiz-player-state";
import type { QuizAttempt } from "../model";
import { resolveQuizFeedbackTransition } from "./resolve-quiz-feedback-transition";
import { useInitialQuizSynchronization } from "./use-initial-quiz-synchronization";
import { useQuizAudio } from "./use-quiz-audio";
import { useQuizClock } from "./use-quiz-clock";
import { useQuizPhaseSnapshot } from "./use-quiz-phase-snapshot";
import { useQuizRecovery } from "./use-quiz-recovery";
export function useQuizPlayerController(input: {
  initialAttempt: QuizAttempt;
  initialRemainingMilliseconds: number;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    quizPlayerReducer,
    createQuizPlayerState(
      input.initialAttempt,
      Math.ceil(input.initialRemainingMilliseconds / 1000),
    ),
  );
  const expireStarted = useRef(false);
  const inFlightRequest = useRef<string | null>(null);
  const timeWarningAnnounced = useRef(false);
  const mounted = useRef(false);
  const transitionTimer = useRef<number | null>(null);
  const promptRef = useRef<HTMLHeadingElement>(null);

  const { currentQuestion, phaseSnapshot } = useQuizPhaseSnapshot(
    state.attempt,
  );
  const audioPresentation = currentQuestion
    ? quizAudioPresentation(currentQuestion)
    : { promptAudioUrl: null, choiceAudioEnabled: false };
  const { cancelPendingPromptAudio, playAnswerAudio, playAudio, primeChoiceAudio } =
    useQuizAudio({
    attemptId: state.attempt.id,
    autoPlayEnabled:
      state.timerSynchronized &&
      state.remainingSeconds > 0 &&
      !state.submitting &&
      state.feedback === null,
    phase: state.attempt.phase,
    playbackReady: state.timerSynchronized,
    preloadAudioUrls: quizPreloadAudioUrls(state.attempt),
    questionId: currentQuestion?.id ?? null,
    promptAudioUrl: audioPresentation.promptAudioUrl,
  });

  const clearTransitionTimer = useCallback(() => {
    if (transitionTimer.current === null) return;
    window.clearTimeout(transitionTimer.current);
    transitionTimer.current = null;
  }, []);
  const handleClockTick = useCallback((remainingSeconds: number) => {
    dispatch({
      type: "timer-ticked",
      remainingSeconds,
    });
  }, []);
  const resetClock = useQuizClock(
    input.initialRemainingMilliseconds,
    handleClockTick,
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTransitionTimer();
    };
  }, [clearTransitionTimer]);

  const recoverFromServer = useQuizRecovery({
    attemptId: state.attempt.id,
    clearTransitionTimer,
    dispatch,
    expireStartedRef: expireStarted,
    inFlightRequestRef: inFlightRequest,
    mountedRef: mounted,
    resetClock,
    timeWarningAnnouncedRef: timeWarningAnnounced,
  });
  const handleInitialSynchronizationFailure = useCallback(() => {
    dispatch({
      type: "submission-failed",
      message: studentAppText.attempt.stateError,
    });
  }, []);
  const triggerInitialSynchronization = useInitialQuizSynchronization(
    recoverFromServer,
    handleInitialSynchronizationFailure,
  );
  const retrySynchronization = useCallback(() => {
    dispatch({ type: "synchronization-started" });
    triggerInitialSynchronization();
  }, [triggerInitialSynchronization]);

  const expireCurrentAttempt = useCallback(async () => {
    if (expireStarted.current || inFlightRequest.current) return;
    expireStarted.current = true;
    inFlightRequest.current = "expiring";
    try {
      const response = await expireQuizAttempt(state.attempt.id);
      if (!mounted.current) return;
      if (response.ok) {
        router.replace("/student/result/" + state.attempt.id);
        return;
      }
      const recovered = await recoverFromServer();
      if (!recovered && mounted.current) {
        inFlightRequest.current = null;
        expireStarted.current = false;
        dispatch({
          type: "submission-failed",
          message: studentAppText.attempt.stateError,
        });
      }
    } catch {
      const recovered = await recoverFromServer();
      if (!recovered && mounted.current) {
        inFlightRequest.current = null;
        expireStarted.current = false;
        dispatch({
          type: "submission-failed",
          message: studentAppText.attempt.stateError,
        });
      }
    }
  }, [recoverFromServer, router, state.attempt.id]);

  useEffect(() => {
    if (
      state.remainingSeconds > 0 &&
      state.timerSynchronized &&
      state.remainingSeconds <= 30 &&
      !timeWarningAnnounced.current
    ) {
      timeWarningAnnounced.current = true;
      dispatch({
        type: "time-warning",
        message: studentAppText.attempt.timeWarning,
      });
    }
  }, [state.remainingSeconds, state.timerSynchronized]);

  const submitChoice = useCallback(
    async (choiceIndex: number | null) => {
      if (
        !currentQuestion ||
        !state.timerSynchronized ||
        inFlightRequest.current !== null ||
        state.submitting ||
        state.feedback !== null ||
        (choiceIndex !== null && state.remainingSeconds === 0) ||
        (state.attempt.phase !== "initial" &&
          state.attempt.phase !== "retry")
      ) {
        return;
      }

      cancelPendingPromptAudio();
      const answerAudioUrl = quizAnswerAudioUrl(currentQuestion, choiceIndex);
      primeChoiceAudio(answerAudioUrl);
      const answeredAttempt = state.attempt;
      const answeredPhase = state.attempt.phase;
      const requestKey = [
        answeredAttempt.id,
        answeredPhase,
        currentQuestion.id,
      ].join(":");
      inFlightRequest.current = requestKey;
      dispatch({
        type: "submission-started",
        phase: answeredPhase,
        choiceIndex,
      });
      let recoveryAttempted = false;
      const tryRecover = async () => {
        if (recoveryAttempted) return false;
        recoveryAttempted = true;
        return recoverFromServer();
      };

      try {
        const {
          ok,
          payload,
          receivedAt,
        } = await submitQuizAnswer({
          attemptId: answeredAttempt.id,
          questionId: currentQuestion.id,
          phase: answeredPhase,
          choiceIndex,
        });
        if (!mounted.current || inFlightRequest.current !== requestKey) return;
        if (!ok) {
          if (await tryRecover()) return;
          throw new Error(
            payload.error ?? studentAppText.attempt.saveError,
          );
        }
        if (payload.expired) {
          inFlightRequest.current = null;
          router.replace("/student/result/" + answeredAttempt.id);
          return;
        }

        dispatch({ type: "answer-received", payload });
        const disposition = quizAnswerDisposition(payload, answeredPhase);
        const transition = await resolveQuizFeedbackTransition({
          answerAudioUrl,
          attemptId: answeredAttempt.id,
          disposition,
          payload,
          playAnswerAudio,
          receivedAt,
        });
        if (
          !mounted.current ||
          inFlightRequest.current !== requestKey
        ) {
          return;
        }
        clearTransitionTimer();
        transitionTimer.current = window.setTimeout(() => {
          transitionTimer.current = null;
          if (!mounted.current) return;
          if (disposition === "result") {
            inFlightRequest.current = null;
            router.replace("/student/result/" + answeredAttempt.id);
            return;
          }
          if (transition.recoverFromServer || disposition === "recover") {
            void tryRecover().then((recovered) => {
              if (recovered || !mounted.current) return;
              inFlightRequest.current = null;
              dispatch({
                type: "submission-failed",
                message: studentAppText.attempt.stateError,
              });
            });
            return;
          }

          const nextTimerDeadlineAt = transition.payload.questionDeadlineAt!;
          const nextRemainingMilliseconds = Math.max(
            0,
            transition.payload.timerRemainingMilliseconds! -
              (performance.now() - transition.receivedAt),
          );
          const nextRemainingSeconds = Math.ceil(
            nextRemainingMilliseconds / 1000,
          );
          inFlightRequest.current = null;
          resetClock(nextRemainingMilliseconds);
          dispatch({
            type: "attempt-replaced",
            attempt: applyQuizAnswerTransition({
              attempt: answeredAttempt,
              answeredQuestionId: currentQuestion.id,
              answeredPhase,
              choiceIndex,
              payload: transition.payload,
              timerDeadlineAt: nextTimerDeadlineAt,
            }),
            remainingSeconds: nextRemainingSeconds,
          });
          timeWarningAnnounced.current = false;
        }, transition.delayMilliseconds);
      } catch (requestError) {
        if (await tryRecover()) return;
        if (!mounted.current) return;
        inFlightRequest.current = null;
        dispatch({
          type: "submission-failed",
          message:
            requestError instanceof Error
              ? requestError.message
              : studentAppText.attempt.saveError,
        });
      }
    },
    [
      clearTransitionTimer,
      cancelPendingPromptAudio,
      currentQuestion,
      playAnswerAudio,
      primeChoiceAudio,
      recoverFromServer,
      resetClock,
      router,
      state.attempt,
      state.feedback,
      state.remainingSeconds,
      state.submitting,
      state.timerSynchronized,
    ],
  );

  useEffect(() => {
    if (
      state.remainingSeconds !== 0 ||
      !state.timerSynchronized ||
      state.attempt.status !== "in_progress"
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (state.attempt.timingMode === "per_question") {
        void submitChoice(null);
      } else {
        void expireCurrentAttempt();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    expireCurrentAttempt,
    state.attempt.status,
    state.attempt.timingMode,
    state.remainingSeconds,
    state.timerSynchronized,
    submitChoice,
  ]);

  useEffect(() => {
    promptRef.current?.focus({ preventScroll: true });
  }, [currentQuestion?.id]);

  const priorWrongIndicator = currentQuestion
    ? getPriorWrongIndicator(currentQuestion.priorWrongLevel)
    : null;
  const answerAnnouncement = quizAnswerAnnouncement(
    state.feedback?.phase ?? state.attempt.phase,
    state.feedback?.correct ?? null,
    state.feedback?.timedOut ?? false,
  );

  return {
    answerAnnouncement,
    audioPresentation,
    completedInPhase: phaseSnapshot.completed,
    currentQuestion,
    phaseQuestionCount: phaseSnapshot.questions.length,
    playAudio,
    priorWrongIndicator,
    progress: phaseSnapshot.progress,
    promptRef,
    retrySynchronization,
    state,
    submitChoice,
  };
}
