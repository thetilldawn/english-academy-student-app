"use client";

import { useCallback, useEffect, useRef } from "react";

import { QuizAudioPlayer } from "./quiz-audio-player";

export function useQuizAudio(input: {
  attemptId: string;
  phase: string;
  playbackReady: boolean;
  preloadAudioUrls: readonly string[];
  questionId: string | null;
  promptAudioUrl: string | null;
}) {
  const playerRef = useRef<QuizAudioPlayer | null>(null);
  const autoPlayedQuestions = useRef(new Set<string>());
  const player = useCallback(() => {
    playerRef.current ??= new QuizAudioPlayer();
    return playerRef.current;
  }, []);
  const preloadKey = input.preloadAudioUrls.join("\u0000");

  useEffect(() => {
    player().preloadChoices(preloadKey ? preloadKey.split("\u0000") : []);
    if (input.promptAudioUrl) player().preparePrompt(input.promptAudioUrl);
    else player().stopPrompt();
  }, [input.promptAudioUrl, player, preloadKey]);

  useEffect(() => () => playerRef.current?.dispose(), []);

  useEffect(() => {
    if (!input.playbackReady || !input.questionId || !input.promptAudioUrl)
      return;
    const playKey = [input.attemptId, input.phase, input.questionId].join(":");
    if (autoPlayedQuestions.current.has(playKey)) return;
    let current = true;
    void player().play(input.promptAudioUrl, "prompt").then((result) => {
      if (current && result === "started")
        autoPlayedQuestions.current.add(playKey);
    });
    return () => {
      current = false;
    };
  }, [
    input.attemptId,
    input.phase,
    input.playbackReady,
    input.promptAudioUrl,
    input.questionId,
    player,
  ]);

  return useCallback((audioUrl: string | null) => {
    if (!audioUrl) return;
    const purpose = audioUrl === input.promptAudioUrl ? "prompt" : "choice";
    void player().play(audioUrl, purpose);
  }, [input.promptAudioUrl, player]);
}
