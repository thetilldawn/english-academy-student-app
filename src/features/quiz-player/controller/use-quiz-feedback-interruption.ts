"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type FeedbackAudioResult<T> =
  | { skipped: true }
  | { skipped: false; playback: T };

export type WaitForFeedbackAudio = <T>(
  play: () => Promise<T>,
) => Promise<FeedbackAudioResult<T>>;

type ActiveWait = {
  requestKey: string;
  finish: () => void;
};

/** Only an acknowledged answer may own this short-lived input window. */
export function useQuizFeedbackInterruption(input: {
  canInterruptAudio: () => boolean;
  inFlightRequestRef: { current: string | null };
  mountedRef: { current: boolean };
  stopAudio: () => void;
}) {
  const { canInterruptAudio, inFlightRequestRef, mountedRef, stopAudio } = input;
  const activeWait = useRef<ActiveWait | null>(null);
  const [waitingKey, setWaitingKey] = useState<string | null>(null);

  const waitForAudio = useCallback(
    <T,>(requestKey: string, play: () => Promise<T>) => {
      activeWait.current?.finish();
      if (!mountedRef.current || inFlightRequestRef.current !== requestKey) {
        return Promise.resolve<FeedbackAudioResult<T>>({ skipped: true });
      }
      return new Promise<FeedbackAudioResult<T>>((resolve, reject) => {
        let settled = false;
        const close = () => {
          if (settled) return false;
          settled = true;
          if (activeWait.current === run) {
            // Close synchronously; a stale rendered button cannot skip grace.
            activeWait.current = null;
            if (mountedRef.current) setWaitingKey(null);
          }
          return true;
        };
        const run: ActiveWait = {
          requestKey,
          finish: () => {
            if (close()) resolve({ skipped: true });
          },
        };
        activeWait.current = run;
        try {
          // Register the completion/interrupt owner before exposing its button.
          const playback = play();
          if (activeWait.current === run) setWaitingKey(requestKey);
          void playback.then(
            (value) => {
              if (close()) resolve({ skipped: false, playback: value });
            },
            (error: unknown) => {
              if (close()) reject(error);
            },
          );
        } catch (error) {
          if (close()) reject(error);
        }
      });
    },
    [inFlightRequestRef, mountedRef],
  );

  const interrupt = useCallback(() => {
    const run = activeWait.current;
    if (
      !run ||
      !canInterruptAudio() ||
      !mountedRef.current ||
      inFlightRequestRef.current !== run.requestKey
    ) return;
    // Settle explicit intent first; ordinary audio "interrupted" is not a skip.
    run.finish();
    stopAudio();
  }, [canInterruptAudio, inFlightRequestRef, mountedRef, stopAudio]);

  useEffect(() => () => {
    activeWait.current?.finish();
  }, []);

  return {
    // Render from state; the event handler checks the current request owner.
    canInterrupt: waitingKey !== null,
    interrupt,
    waitForAudio,
  };
}
