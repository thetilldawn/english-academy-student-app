"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { formatContentText } from "@/content/format";
import { studentAppText } from "@/content/ko/student-app";
import { formatRemainingSeconds } from "@/lib/deadline";

import styles from "./deadline-countdown.module.css";

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
    const startedAt = performance.now();

    const update = () => {
      const elapsedSeconds = Math.floor(
        (performance.now() - startedAt) / 1000,
      );
      const nextRemaining = Math.max(
        0,
        initialRemainingSeconds - elapsedSeconds,
      );
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
  }, [deadlineAt, initialRemainingSeconds, refreshOnExpire, router]);

  const expired = remainingSeconds === 0;

  return (
    <>
      <span
        aria-label={
          expired
            ? studentAppText.actions.deadlinePassed
            : formatContentText(studentAppText.actions.deadlineRemaining, {
                time: formatRemainingSeconds(remainingSeconds),
              })
        }
        aria-live="off"
        className={
          expired ? `${styles.timer} ${styles.expired}` : styles.timer
        }
        role="timer"
      >
        {expired
          ? studentAppText.actions.deadlineClosed
          : formatRemainingSeconds(remainingSeconds)}
      </span>
      <span aria-live="polite" className={styles.srOnly} role="status">
        {expired ? studentAppText.actions.deadlinePassed : ""}
      </span>
    </>
  );
}
