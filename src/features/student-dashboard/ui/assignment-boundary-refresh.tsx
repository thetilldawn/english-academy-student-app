"use client";

import { useRouter } from "next/navigation";
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
  const refreshedRef = useRef(false);

  useEffect(() => {
    let timeoutId: number | null = null;
    const startedAt = performance.now();

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

    refreshedRef.current = false;
    schedule();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") schedule();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [boundaryAt, initialRemainingMilliseconds, router]);

  return null;
}
