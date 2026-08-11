"use client";

import { useEffect, useReducer, useRef } from "react";

export function useInitialQuizSynchronization(
  synchronize: () => Promise<boolean>,
  onFailure: () => void,
) {
  const [requestVersion, retry] = useReducer((value) => value + 1, 0);
  const inFlight = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
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
  }, [onFailure, requestVersion, synchronize]);

  return retry;
}
