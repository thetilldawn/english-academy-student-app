"use client";

import { useEffect } from "react";

export function useQuizClockLifecycle({
  clearExpiryTimer,
  enabled,
  hasClock,
  initialRemainingMilliseconds,
  resetClock,
  updateRemaining,
}: {
  clearExpiryTimer: () => void;
  enabled: boolean;
  hasClock: () => boolean;
  initialRemainingMilliseconds: number;
  resetClock: (remainingMilliseconds: number) => void;
  updateRemaining: () => void;
}) {
  useEffect(() => {
    if (!enabled) {
      resetClock(1_000);
      return;
    }
    if (!hasClock()) resetClock(initialRemainingMilliseconds);
  }, [enabled, hasClock, initialRemainingMilliseconds, resetClock]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(updateRemaining, 500);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") updateRemaining();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      clearExpiryTimer();
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, [clearExpiryTimer, enabled, updateRemaining]);
}
