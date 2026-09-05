"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ManagedAudioPlayer } from "@/lib/audio/managed-audio-player";

export function useStudyAudio() {
  const player = useMemo(() => new ManagedAudioPlayer(), []);
  const generation = useRef(0);
  const [failedWord, setFailedWord] = useState<string | null>(null);
  useEffect(() => () => {
    generation.current += 1;
    player.dispose();
  }, [player]);
  const play = useCallback(async (key: string, audioUrl: string) => {
    const request = ++generation.current;
    setFailedWord(null);
    const outcome = await player.play(audioUrl);
    if (request === generation.current && (outcome === "failed" || outcome === "blocked")) {
      setFailedWord(key);
    }
  }, [player]);
  return { failedWord, play };
}
