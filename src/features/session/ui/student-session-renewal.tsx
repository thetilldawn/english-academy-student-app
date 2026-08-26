"use client";

import { useEffect } from "react";

import { requestStudentSessionRenewal } from "../api/session";

const RETRY_DELAY_MS = 15 * 60 * 1000;

export function StudentSessionRenewal({
  initialDelayMilliseconds,
}: {
  initialDelayMilliseconds: number;
}) {
  useEffect(() => {
    let disposed = false;
    let timerId: number | undefined;
    let controller: AbortController | undefined;
    let inFlight = false;
    let nextCheckAt = Date.now();

    const schedule = (delayMilliseconds: number) => {
      if (timerId !== undefined) window.clearTimeout(timerId);
      const delay = Math.max(0, delayMilliseconds);
      nextCheckAt = Date.now() + delay;
      timerId = window.setTimeout(async () => {
        timerId = undefined;
        if (disposed || inFlight) return;
        if (document.visibilityState !== "visible") {
          nextCheckAt = Date.now();
          return;
        }
        inFlight = true;
        controller = new AbortController();
        const result = await requestStudentSessionRenewal(controller.signal);
        inFlight = false;
        if (disposed || result.status === "aborted") return;
        if (result.status === "invalid") {
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
        Date.now() >= nextCheckAt
      ) {
        schedule(0);
      }
    };

    schedule(initialDelayMilliseconds);
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
  }, [initialDelayMilliseconds]);

  return null;
}
