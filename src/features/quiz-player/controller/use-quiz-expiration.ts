"use client";

import { useCallback, useLayoutEffect, useRef, type Dispatch } from "react";
import type { QuizTransport } from "../api/quiz-transport";
import { canRetryQuizExpiration, EXPIRATION_RETRY_DELAYS_MS } from "../domain/quiz-expiration";
import { quizResultIsConfirmed } from "../domain/quiz-session";
import type { QuizPlayerAction } from "../domain/quiz-player-state";
import type { QuizExpirationResponse } from "../model";
import type { BeforeQuizRestore, QuizRecoverySnapshot } from "./use-quiz-recovery";

type ExpirationState = {
  kind: "idle" | "requesting" | "checking" | "backoff" | "attention" | "done";
  tries: number;
  retryable: boolean;
};

export function useQuizExpiration(input: {
  attemptId: string;
  transport: QuizTransport;
  dispatch: Dispatch<QuizPlayerAction>;
  mountedRef: { current: boolean };
  inFlightRequestRef: { current: string | null };
  onResult: (id: string) => void;
  recoverFromServer: (before?: BeforeQuizRestore, confirmed?: QuizRecoverySnapshot) => Promise<boolean>;
}) {
  const state = useRef<ExpirationState>({ kind: "idle", tries: 0, retryable: false });
  const generation = useRef(0);
  const ownedRequest = useRef<string | null>(null);
  useLayoutEffect(() => {
    state.current = { kind: "idle", tries: 0, retryable: false };
    return () => {
      generation.current += 1;
      if (input.inFlightRequestRef.current === ownedRequest.current) input.inFlightRequestRef.current = null;
      ownedRequest.current = null;
    };
  }, [input.attemptId, input.transport, input.inFlightRequestRef]);

  const run = useCallback(async (manual: boolean) => {
    if (input.inFlightRequestRef.current || (!manual && state.current.kind !== "idle") || state.current.kind === "done") return;
    const serial = ++generation.current;
    const owner = `expiring:${input.attemptId}:${serial}`;
    input.inFlightRequestRef.current = owner;
    ownedRequest.current = owner;
    input.dispatch({ type: "expiration-started" });
    const active = () => input.mountedRef.current && generation.current === serial && input.inFlightRequestRef.current === owner;
    let failureMessage = "시험 종료를 확인하지 못했습니다. 다시 확인해 주세요.";
    const finish = () => {
      if (!active()) return;
      state.current.kind = "done";
      input.inFlightRequestRef.current = null;
      input.onResult(input.attemptId);
    };
    const check = async (): Promise<"terminal" | QuizRecoverySnapshot | null> => {
      state.current.kind = "checking";
      try {
        const response = await input.transport.read(input.attemptId);
        if (!active()) return null;
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status ?? 0)) {
            state.current.retryable = false;
            failureMessage = response.payload.error ?? "학생 인증과 시험 상태를 다시 확인해 주세요.";
          }
          return null;
        }
        if (response.payload.attempt.id !== input.attemptId) { state.current.retryable = false; return null; }
        if (quizResultIsConfirmed(response.payload)) {
          input.transport.studentStateConfirmed?.();
          finish(); return "terminal";
        }
        return response;
      } catch { return null; }
    };
    const attention = () => {
      if (!active()) return;
      state.current.kind = "attention";
      input.inFlightRequestRef.current = null;
      input.dispatch({ type: "submission-failed", message: failureMessage });
    };
    if (manual) {
      const checked = await check();
      if (!active() || checked === "terminal") return;
      // A read can restore a still-valid deadline without issuing another write.
      if (checked && checked.payload.attempt.status === "in_progress" && checked.payload.timerRemainingMilliseconds > 0) {
        state.current.kind = "idle";
        if (!await input.recoverFromServer(undefined, checked)) attention();
        return;
      }
      if (!state.current.retryable) { attention(); return; }
    }
    if (!manual && state.current.tries >= 3) { attention(); return; }
    for (;;) {
      if (!active()) return;
      state.current.kind = "requesting";
      state.current.tries += 1;
      let response: QuizExpirationResponse;
      try { response = await input.transport.expire(input.attemptId); }
      catch { response = { ok: false, payload: { outcome: "unknown" } }; }
      if (!active()) return;
      if (response.ok) { finish(); return; }
      state.current.retryable = canRetryQuizExpiration(response);
      const checked = await check();
      if (!active() || checked === "terminal") return;
      if (checked && checked.payload.attempt.status === "in_progress" && checked.payload.timerRemainingMilliseconds > 0 && response.payload.outcome === "not_applied") {
        state.current.kind = "idle";
        if (!await input.recoverFromServer(undefined, checked)) attention();
        return;
      }
      const delay = EXPIRATION_RETRY_DELAYS_MS[state.current.tries - 1];
      // A transport error does not prove the earlier write has stopped.
      if (manual || !state.current.retryable || delay === undefined) { attention(); return; }
      state.current.kind = "backoff";
      await new Promise<void>(resolve => setTimeout(resolve, delay));
    }
  }, [input]);
  const expire = useCallback(() => { void run(false); }, [run]);
  const retry = useCallback(() => {
    if (state.current.kind === "idle") return false;
    void run(true);
    return true;
  }, [run]);
  return { expire, retry };
}
