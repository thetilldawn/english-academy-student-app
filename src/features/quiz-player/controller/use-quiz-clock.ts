"use client";

import { useCallback, useEffect, useRef } from "react";

export function useQuizClock(
  initialRemainingMilliseconds: number,
  onTick: (remainingSeconds: number) => void,
) {
  const clockAnchor = useRef<{
    remainingMilliseconds: number;
    startedAt: number;
  } | null>(null);
  const expiryTimer = useRef<number | null>(null);

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
      const safeRemaining = Math.max(0, remainingMilliseconds);
      if (expiryTimer.current !== null) {
        window.clearTimeout(expiryTimer.current);
      }
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
    [onTick, updateRemaining],
  );

  useEffect(() => {
    if (clockAnchor.current) return;
    resetClock(initialRemainingMilliseconds);
  }, [initialRemainingMilliseconds, resetClock]);

  useEffect(() => {
    const timer = window.setInterval(updateRemaining, 500);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") updateRemaining();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      if (expiryTimer.current !== null) {
        window.clearTimeout(expiryTimer.current);
      }
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, [updateRemaining]);

  return resetClock;
}
