"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { requestStudentSessionRenewal } from "../api/session";
import { announceStudentPrivateCacheChange } from "../controller/student-private-cache-events";

const RETRY_DELAY_MS = 15 * 60 * 1000;

export function StudentSessionRenewal({
  initialDelayMilliseconds,
}: {
  initialDelayMilliseconds: number;
}) {
  const quizOpen = usePathname() === "/quiz-offline";
  const nextCheck = useRef<number | null>(null);
  useEffect(() => {
    if (quizOpen) return;
    let disposed = false;
    let timerId: number | undefined;
    let controller: AbortController | undefined;
    let inFlight = false;
    nextCheck.current ??= Date.now() + initialDelayMilliseconds;

    const schedule = (delayMilliseconds: number) => {
      if (timerId !== undefined) window.clearTimeout(timerId);
      const delay = Math.max(0, delayMilliseconds);
      nextCheck.current = Date.now() + delay;
      timerId = window.setTimeout(async () => {
        timerId = undefined;
        if (disposed || inFlight) return;
        if (document.visibilityState !== "visible") {
          nextCheck.current = Date.now();
          return;
        }
        inFlight = true;
        controller = new AbortController();
        const result = await requestStudentSessionRenewal(controller.signal);
        inFlight = false;
        if (disposed || result.status === "aborted") return;
        if (result.status === "invalid") {
          announceStudentPrivateCacheChange("identity");
          window.location.replace("/");
          return;
        }
        schedule(
          result.status === "ok"
            ? result.nextCheckInMilliseconds
            : RETRY_DELAY_MS,
        );
      }, delay);
    };

    const resumeIfDue = () => {
      if (
        !disposed &&
        !inFlight &&
        document.visibilityState === "visible" &&
        Date.now() >= (nextCheck.current ?? 0)
      ) {
        schedule(0);
      }
    };

    schedule(nextCheck.current - Date.now());
    document.addEventListener("visibilitychange", resumeIfDue);
    window.addEventListener("pageshow", resumeIfDue);
    window.addEventListener("online", resumeIfDue);
    return () => {
      disposed = true;
      controller?.abort();
      if (timerId !== undefined) window.clearTimeout(timerId);
      document.removeEventListener("visibilitychange", resumeIfDue);
      window.removeEventListener("pageshow", resumeIfDue);
      window.removeEventListener("online", resumeIfDue);
    };
  }, [initialDelayMilliseconds, quizOpen]);

  return null;
}
