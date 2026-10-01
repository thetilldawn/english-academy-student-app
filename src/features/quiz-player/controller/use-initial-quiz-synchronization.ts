"use client";

import { useEffect, useReducer, useRef } from "react";

export function useInitialQuizSynchronization(
  synchronize: () => Promise<boolean>,
  onFailure: () => void,
  initialTimerReady = false,
) {
  const [requestVersion, retry] = useReducer((value) => value + 1, 0);
  const inFlight = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    if (initialTimerReady && requestVersion === 0) return;
    let active = true;
    const request = inFlight.current ?? synchronize();
    inFlight.current = request;
    void request.then((synchronized) => {
      if (inFlight.current === request) inFlight.current = null;
      if (active && !synchronized) onFailure();
    });
    return () => {
      active = false;
    };
  }, [initialTimerReady, onFailure, requestVersion, synchronize]);

  return retry;
}
