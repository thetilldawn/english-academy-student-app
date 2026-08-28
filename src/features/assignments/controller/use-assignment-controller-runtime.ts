"use client";

import { useEffect, useState } from "react";

import { createAssignmentSubmissionSession } from "../application/submission-flow";

export function useAssignmentMinuteClock({
  clock,
  initializeFromClock,
}: {
  clock: () => number;
  initializeFromClock: boolean;
}) {
  const [nowMilliseconds, setNowMilliseconds] = useState(() =>
    initializeFromClock ? clock() : 0,
  );

  useEffect(() => {
    const updateNow = () => setNowMilliseconds(clock());
    if (!initializeFromClock) updateNow();
    const intervalId = window.setInterval(updateNow, 60_000);
    return () => window.clearInterval(intervalId);
  }, [clock, initializeFromClock]);

  return nowMilliseconds;
}

export function useAssignmentSubmissionSession() {
  const [session] = useState(createAssignmentSubmissionSession);
  return session;
}
