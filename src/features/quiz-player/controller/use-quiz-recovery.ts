"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, type Dispatch } from "react";

import { regularQuizTransport, type QuizTransport } from "../api/quiz-transport";
import { quizAttemptUsesDeadlineClock, quizResultIsConfirmed } from "../domain/quiz-session";
import type { QuizPlayerAction } from "../domain/quiz-player-state";
import type { QuizAttemptResponse } from "../model";

export type QuizRecoverySnapshot = { payload: QuizAttemptResponse; receivedAt: number };
export type BeforeQuizRestore = (snapshot: QuizRecoverySnapshot & {
  isCurrent: () => boolean;
}) => Promise<QuizRecoverySnapshot | null>;

type MutableValue<T> = { current: T };

export function useQuizRecovery(input: {
  transport?: QuizTransport;
  attemptId: string;
  deadlineSubmissionNotBeforeRef: MutableValue<number>;
  dispatch: Dispatch<QuizPlayerAction>;
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
    inFlightRequestRef,
    mountedRef,
    resetClock,
    timeWarningAnnouncedRef,
  } = input;
  const transport = input.transport ?? regularQuizTransport;
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, [attemptId, transport]);

  return useCallback(async (beforeRestore?: BeforeQuizRestore, confirmed?: QuizRecoverySnapshot) => {
    const version = ++generation.current;
    const owner = inFlightRequestRef.current;
    const isCurrent = () => mountedRef.current && generation.current === version &&
      inFlightRequestRef.current === owner;
    try {
      const response = confirmed ? { ok: true as const, ...confirmed } : await transport.read(attemptId);
      if (!isCurrent()) return true;
      if (
        !response.ok || response.payload.attempt.id !== attemptId ||
        !Number.isFinite(response.payload.timerRemainingMilliseconds)
      ) {
        return false;
      }
      let snapshot: QuizRecoverySnapshot = response;
      if (beforeRestore) {
        const decision = await beforeRestore({ ...snapshot, isCurrent });
        if (!isCurrent()) return true;
        if (!decision) return false;
        snapshot = decision;
      }
      const { payload, receivedAt } = snapshot;
      if (
        payload.attempt.status !== "in_progress" ||
        payload.attempt.phase === "review" ||
        payload.attempt.phase === "completed"
      ) {
        if (!quizResultIsConfirmed(payload)) return false;
        inFlightRequestRef.current = null;
        replace(transport.resultHref(attemptId));
        return true;
      }

      const transitionRemaining = payload.transitionRemainingMilliseconds ?? 0;
      if (!Number.isFinite(transitionRemaining) || transitionRemaining < 0 ||
          transitionRemaining > 7_250) return false;
      const waitMilliseconds = Math.max(0,
        transitionRemaining - (performance.now() - receivedAt));
      if (waitMilliseconds > 0) {
        // A failed feedback acknowledgement can leave the server's reservation
        // outstanding. It is waiting time, not extra time to answer questions.
        dispatch({ type: "next-question-preparing" });
        await new Promise<void>(resolve => window.setTimeout(resolve, waitMilliseconds));
        if (!isCurrent()) return true;
      }
      inFlightRequestRef.current = null;
      const elapsedAdjustedMilliseconds = Math.max(
        0,
        payload.timerRemainingMilliseconds -
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
      timeWarningAnnouncedRef.current = false;
      resetClock(safeRemainingMilliseconds);
      dispatch({
        type: "attempt-replaced",
        attempt: payload.attempt,
        remainingSeconds: Math.ceil(safeRemainingMilliseconds / 1000),
      });
      return true;
    } catch {
      return !isCurrent();
    }
  }, [
    attemptId,
    deadlineSubmissionNotBeforeRef,
    dispatch,
    inFlightRequestRef,
    mountedRef,
    replace,
    resetClock,
    timeWarningAnnouncedRef,
    transport,
  ]);
}
