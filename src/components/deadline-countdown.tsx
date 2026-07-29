"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  formatRemainingSeconds,
  secondsUntil,
} from "@/lib/deadline";

export function DeadlineCountdown({
  deadlineAt,
  initialRemainingSeconds,
  refreshOnExpire = false,
}: {
  deadlineAt: string;
  initialRemainingSeconds: number;
  refreshOnExpire?: boolean;
}) {
  const router = useRouter();
  const refreshedRef = useRef(false);
  const [remainingSeconds, setRemainingSeconds] = useState(
    initialRemainingSeconds,
  );

  useEffect(() => {
    refreshedRef.current = false;

    const update = () => {
      const nextRemaining = secondsUntil(deadlineAt, Date.now()) ?? 0;
      setRemainingSeconds(nextRemaining);
      if (
        nextRemaining === 0 &&
        refreshOnExpire &&
        !refreshedRef.current
      ) {
        refreshedRef.current = true;
        router.refresh();
      }
    };

    update();
    const intervalId = window.setInterval(update, 1000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, [deadlineAt, refreshOnExpire, router]);

  const expired = remainingSeconds === 0;

  return (
    <>
      <span
        aria-label={
          expired
            ? "응시 시작 마감이 지났습니다."
            : `응시 시작 마감까지 ${formatRemainingSeconds(
                remainingSeconds,
              )} 남았습니다.`
        }
        aria-live="off"
        className={expired ? "deadline-countdown deadline-expired" : "deadline-countdown"}
        role="timer"
      >
        {expired
          ? "마감됨"
          : formatRemainingSeconds(remainingSeconds)}
      </span>
      <span aria-live="polite" className="sr-only" role="status">
        {expired ? "응시 시작 마감이 지났습니다." : ""}
      </span>
    </>
  );
}
