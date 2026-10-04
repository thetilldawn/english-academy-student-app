"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const maximumTimeoutMilliseconds = 2_147_000_000;

export function AssignmentBoundaryRefresh({
  boundaryAt,
  initialRemainingMilliseconds,
}: {
  boundaryAt: string;
  initialRemainingMilliseconds: number;
}) {
  const router = useRouter();
  const quizOpen = usePathname() === "/quiz-offline";
  const clock = useRef<{ boundary: string; remaining: number; startedAt: number } | null>(null);
  const refreshedRef = useRef(false);

  useEffect(() => {
    if (clock.current?.boundary !== boundaryAt || clock.current.remaining !== initialRemainingMilliseconds) {
      clock.current = { boundary: boundaryAt, remaining: initialRemainingMilliseconds, startedAt: performance.now() };
      refreshedRef.current = false;
    }
    if (quizOpen) return;
    let timeoutId: number | null = null;
    const startedAt = clock.current.startedAt;

    const schedule = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      const elapsed = performance.now() - startedAt;
      const remaining = initialRemainingMilliseconds - elapsed;
      if (remaining <= 0) {
        if (!refreshedRef.current) {
          refreshedRef.current = true;
          router.refresh();
        }
        return;
      }
      timeoutId = window.setTimeout(
        schedule,
        Math.min(remaining, maximumTimeoutMilliseconds),
      );
    };

    schedule();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") schedule();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [boundaryAt, initialRemainingMilliseconds, router, quizOpen]);

  return null;
}
