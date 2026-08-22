"use client";

import { useCallback, useRef } from "react";

import { useQuizClockLifecycle } from "./use-quiz-clock-lifecycle";

export function useQuizClock(
  initialRemainingMilliseconds: number,
  onTick: (remainingSeconds: number) => void,
  enabled = true,
) {
  const clockAnchor = useRef<{
    remainingMilliseconds: number;
    startedAt: number;
  } | null>(null);
  const expiryTimer = useRef<number | null>(null);

  const clearExpiryTimer = useCallback(() => {
    if (expiryTimer.current === null) return;
    window.clearTimeout(expiryTimer.current);
    expiryTimer.current = null;
  }, []);
  const hasClock = useCallback(() => Boolean(clockAnchor.current), []);

  const updateRemaining = useCallback(() => {
    const anchor = clockAnchor.current;
    if (!anchor) return;
    const elapsed = performance.now() - anchor.startedAt;
    const remainingMilliseconds = Math.max(
      0,
      anchor.remainingMilliseconds - elapsed,
    );
    onTick(Math.ceil(remainingMilliseconds / 1000));
  }, [onTick]);

  const resetClock = useCallback(
    (remainingMilliseconds: number) => {
      if (!enabled) {
        clockAnchor.current = null;
        clearExpiryTimer();
        onTick(1);
        return;
      }
      const safeRemaining = Math.max(0, remainingMilliseconds);
      clearExpiryTimer();
      clockAnchor.current = {
        remainingMilliseconds: safeRemaining,
        startedAt: performance.now(),
      };
      onTick(Math.ceil(safeRemaining / 1000));
      expiryTimer.current = window.setTimeout(() => {
        expiryTimer.current = null;
        updateRemaining();
      }, Math.ceil(safeRemaining) + 1);
    },
    [clearExpiryTimer, enabled, onTick, updateRemaining],
  );

  useQuizClockLifecycle({
    clearExpiryTimer,
    enabled,
    hasClock,
    initialRemainingMilliseconds,
    resetClock,
    updateRemaining,
  });

  return resetClock;
}
