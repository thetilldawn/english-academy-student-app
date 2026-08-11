"use client";

import { useCallback, useEffect, useRef } from "react";

export function useQuizAudio(input: {
  attemptId: string;
  phase: string;
  questionId: string | null;
  promptAudioUrl: string | null;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoPlayedQuestions = useRef(new Set<string>());

  const playAudio = useCallback((audioUrl: string | null) => {
    if (!audioUrl) return;
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.pause();
    audio.currentTime = 0;
    audio.src = audioUrl;
    void audio.play().catch(() => {
      // Optional audio must not interrupt answer persistence or server timing.
    });
  }, []);

  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
  }, []);

  useEffect(() => {
    return () => {
      stopAudio();
      audioRef.current = null;
    };
  }, [stopAudio]);

  useEffect(() => {
    stopAudio();
    if (!input.questionId || !input.promptAudioUrl) return;
    const playKey = [
      input.attemptId,
      input.phase,
      input.questionId,
    ].join(":");
    if (autoPlayedQuestions.current.has(playKey)) return;
    autoPlayedQuestions.current.add(playKey);
    playAudio(input.promptAudioUrl);
  }, [
    input.attemptId,
    input.phase,
    input.promptAudioUrl,
    input.questionId,
    playAudio,
    stopAudio,
  ]);

  return playAudio;
}
