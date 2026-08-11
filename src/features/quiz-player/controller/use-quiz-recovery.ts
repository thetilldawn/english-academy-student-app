"use client";

import { useRouter } from "next/navigation";
import { useCallback, type Dispatch } from "react";

import { recoverQuizAttempt } from "../api/quiz-attempt";
import type { QuizPlayerAction } from "../domain/quiz-player-state";

type MutableValue<T> = { current: T };

export function useQuizRecovery(input: {
  attemptId: string;
  clearTransitionTimer: () => void;
  dispatch: Dispatch<QuizPlayerAction>;
  expireStartedRef: MutableValue<boolean>;
  inFlightRequestRef: MutableValue<string | null>;
  mountedRef: MutableValue<boolean>;
  resetClock: (remainingMilliseconds: number) => void;
  timeWarningAnnouncedRef: MutableValue<boolean>;
}) {
  const { replace } = useRouter();
  const {
    attemptId,
    clearTransitionTimer,
    dispatch,
    expireStartedRef,
    inFlightRequestRef,
    mountedRef,
    resetClock,
    timeWarningAnnouncedRef,
  } = input;

  return useCallback(async () => {
    try {
      const { ok, payload, roundTripMilliseconds } =
        await recoverQuizAttempt(attemptId);
      if (!mountedRef.current) return true;
      if (
        !ok ||
        typeof payload.timerRemainingMilliseconds !== "number" ||
        !Number.isFinite(payload.timerRemainingMilliseconds)
      ) {
        return false;
      }
      clearTransitionTimer();
      inFlightRequestRef.current = null;
      if (
        payload.attempt.status !== "in_progress" ||
        payload.attempt.phase === "review" ||
        payload.attempt.phase === "completed"
      ) {
        replace("/student/result/" + attemptId);
        return true;
      }

      const safeRemainingMilliseconds = Math.max(
        0,
        payload.timerRemainingMilliseconds - roundTripMilliseconds,
      );
      expireStartedRef.current = false;
      timeWarningAnnouncedRef.current = false;
      resetClock(safeRemainingMilliseconds);
      dispatch({
        type: "attempt-replaced",
        attempt: payload.attempt,
        remainingSeconds: Math.ceil(safeRemainingMilliseconds / 1000),
      });
      return true;
    } catch {
      return false;
    }
  }, [
    attemptId,
    clearTransitionTimer,
    dispatch,
    expireStartedRef,
    inFlightRequestRef,
    mountedRef,
    replace,
    resetClock,
    timeWarningAnnouncedRef,
  ]);
}
