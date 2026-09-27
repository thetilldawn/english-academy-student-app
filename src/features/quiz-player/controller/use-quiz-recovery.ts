"use client";

import { useRouter } from "next/navigation";
import { useCallback, type Dispatch } from "react";

import { recoverQuizAttempt } from "../api/quiz-attempt";
import { quizAttemptUsesDeadlineClock } from "../domain/quiz-session";
import type { QuizPlayerAction } from "../domain/quiz-player-state";

type MutableValue<T> = { current: T };

export function useQuizRecovery(input: {
  attemptId: string;
  deadlineSubmissionNotBeforeRef: MutableValue<number>;
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
    deadlineSubmissionNotBeforeRef,
    dispatch,
    expireStartedRef,
    inFlightRequestRef,
    mountedRef,
    resetClock,
    timeWarningAnnouncedRef,
  } = input;

  return useCallback(async () => {
    try {
      const { ok, payload, receivedAt, roundTripMilliseconds } =
        await recoverQuizAttempt(attemptId);
      if (!mountedRef.current) return true;
      if (
        !ok ||
        typeof payload.timerRemainingMilliseconds !== "number" ||
        !Number.isFinite(payload.timerRemainingMilliseconds)
      ) {
        return false;
      }
      if (
        payload.attempt.status !== "in_progress" ||
        payload.attempt.phase === "review" ||
        payload.attempt.phase === "completed"
      ) {
        inFlightRequestRef.current = null;
        replace("/student/result/" + attemptId);
        return true;
      }

      const transitionRemaining = payload.transitionRemainingMilliseconds ?? 0;
      if (!Number.isFinite(transitionRemaining) || transitionRemaining < 0 ||
          transitionRemaining > 7_250) return false;
      if (transitionRemaining > 0) {
        // A failed feedback acknowledgement can leave the server's reservation
        // outstanding. It is waiting time, not extra time to answer questions.
        dispatch({ type: "synchronization-started" });
        const waitMilliseconds = Math.max(0,
          transitionRemaining - (performance.now() - receivedAt));
        await new Promise<void>(resolve => window.setTimeout(resolve, waitMilliseconds));
        if (!mountedRef.current) return true;
      }
      inFlightRequestRef.current = null;
      const elapsedAdjustedMilliseconds = Math.max(
        0,
        payload.timerRemainingMilliseconds - roundTripMilliseconds -
          (performance.now() - receivedAt),
      );
      const safeRemainingMilliseconds =
        !quizAttemptUsesDeadlineClock(payload.attempt)
          ? 1_000
          : payload.attempt.timingMode === "per_question" &&
              payload.attempt.questionTimeLimitSeconds
            ? Math.min(
                elapsedAdjustedMilliseconds,
                payload.attempt.questionTimeLimitSeconds * 1_000,
              )
            : elapsedAdjustedMilliseconds;
      deadlineSubmissionNotBeforeRef.current = quizAttemptUsesDeadlineClock(
        payload.attempt,
      )
        ? receivedAt + payload.timerRemainingMilliseconds
        : 0;
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
    deadlineSubmissionNotBeforeRef,
    dispatch,
    expireStartedRef,
    inFlightRequestRef,
    mountedRef,
    replace,
    resetClock,
    timeWarningAnnouncedRef,
  ]);
}
