"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef } from "react";

import { studentAppText } from "@/content/ko/student-app";
import { getPriorWrongIndicator } from "@/lib/quiz/prior-wrong";

import { expireQuizAttempt } from "../api/quiz-attempt";
import {
  quizAnswerAnnouncement,
  quizAudioPresentation,
  quizPreloadAudioUrls,
} from "../domain/quiz-session";
import {
  createQuizPlayerState,
  quizPlayerReducer,
} from "../domain/quiz-player-state";
import type { QuizAttempt } from "../model";
import { useInitialQuizSynchronization } from "./use-initial-quiz-synchronization";
import { useQuizAudio } from "./use-quiz-audio";
import { useQuizClock } from "./use-quiz-clock";
import { useQuizPhaseSnapshot } from "./use-quiz-phase-snapshot";
import { useQuizRecovery } from "./use-quiz-recovery";
import { useQuizSubmission } from "./use-quiz-submission";
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
    };
  }, []);

  const recoverFromServer = useQuizRecovery({
    attemptId: state.attempt.id,
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

  const submitChoice = useQuizSubmission({
    cancelPendingPromptAudio,
    currentQuestion,
    dispatch,
    inFlightRequestRef: inFlightRequest,
    mountedRef: mounted,
    onResult: (attemptId) => router.replace("/student/result/" + attemptId),
    playAnswerAudio,
    primeChoiceAudio,
    recoverFromServer,
    resetClock,
    state,
    timeWarningAnnouncedRef: timeWarningAnnounced,
  });

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
