"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react";

import { ManagedAudioPlayer } from "@/lib/audio/managed-audio-player";

const ResultAudioContext = createContext<
  ((audioUrl: string) => void) | null
>(null);

export function ResultAudioProvider({ children }: { children: ReactNode }) {
  const player = useMemo(() => new ManagedAudioPlayer(), []);

  useEffect(() => () => player.dispose(), [player]);

  return (
    <ResultAudioContext.Provider
      value={(audioUrl) => {
        void player.play(audioUrl);
      }}
    >
      {children}
    </ResultAudioContext.Provider>
  );
}

export function useResultAudio() {
  const play = useContext(ResultAudioContext);
  if (!play) throw new Error("result_audio_provider_missing");
  return play;
}
