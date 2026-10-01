"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  ANSWER_AUDIO_END_TIMEOUT_MS,
  ANSWER_AUDIO_START_TIMEOUT_MS,
  PROMPT_AUDIO_AUTOPLAY_DELAY_MS,
} from "../domain/quiz-session";
import { QuizAudioPlayer } from "./quiz-audio-player";

export function useQuizAudioRuntime(input: {
  attemptId: string;
  autoPlayEnabled: boolean;
  phase: string;
  playbackReady: boolean;
  preloadAudioUrls: readonly string[];
  questionId: string | null;
  promptAudioUrl: string | null;
}) {
  const playerRef = useRef<QuizAudioPlayer | null>(null);
  const autoPlayedQuestions = useRef(new Set<string>());
  const autoPlayTimer = useRef<number | null>(null);
  const player = useCallback(() => {
    playerRef.current ??= new QuizAudioPlayer();
    return playerRef.current;
  }, []);
  const clearAutoPlayTimer = useCallback(() => {
    if (autoPlayTimer.current === null) return;
    window.clearTimeout(autoPlayTimer.current);
    autoPlayTimer.current = null;
  }, []);
  const playKey = input.questionId
    ? [input.attemptId, input.phase, input.questionId].join(":")
    : null;
  const preloadKey = input.preloadAudioUrls.join("\u0000");
  const playPromptUntilEnded = useCallback(
    (audioUrl: string) =>
      player()
          .playUntilEnded(
            audioUrl,
            "prompt",
            ANSWER_AUDIO_END_TIMEOUT_MS,
            ANSWER_AUDIO_START_TIMEOUT_MS,
          )
          .then((outcome) => ({
            completedAt: performance.now(),
            outcome,
          })),
    [player],
  );

  useEffect(() => {
    const preloadUrls = preloadKey ? preloadKey.split("\u0000") : [];
    player().preloadChoices(
      input.promptAudioUrl
        ? [...new Set([input.promptAudioUrl, ...preloadUrls])]
        : preloadUrls,
    );
    if (!input.promptAudioUrl) player().stopPrompt();
  }, [input.promptAudioUrl, player, preloadKey]);

  useEffect(
    () => () => {
      clearAutoPlayTimer();
      playerRef.current?.dispose();
    },
    [clearAutoPlayTimer],
  );

  useEffect(() => {
    clearAutoPlayTimer();
    if (
      !input.autoPlayEnabled ||
      !input.playbackReady ||
      !playKey ||
      !input.promptAudioUrl
    )
      return;
    if (autoPlayedQuestions.current.has(playKey)) return;
    let current = true;
    autoPlayTimer.current = window.setTimeout(() => {
      autoPlayTimer.current = null;
      const promptAudioUrl = input.promptAudioUrl;
      if (!promptAudioUrl) return;
      autoPlayedQuestions.current.add(playKey);
      void playPromptUntilEnded(promptAudioUrl).then(({ outcome }) => {
        if (current && ["blocked", "failed"].includes(outcome)) {
          autoPlayedQuestions.current.delete(playKey);
        }
      });
    }, PROMPT_AUDIO_AUTOPLAY_DELAY_MS);
    return () => {
      current = false;
      clearAutoPlayTimer();
    };
  }, [
    clearAutoPlayTimer,
    input.autoPlayEnabled,
    input.playbackReady,
    input.promptAudioUrl,
    playKey,
    playPromptUntilEnded,
  ]);

  const playAudio = useCallback((audioUrl: string | null) => {
    if (!audioUrl) return;
    const purpose = audioUrl === input.promptAudioUrl ? "prompt" : "choice";
    if (purpose === "prompt") clearAutoPlayTimer();
    if (purpose === "prompt" && playKey) {
      autoPlayedQuestions.current.add(playKey);
      void playPromptUntilEnded(audioUrl).then(({ outcome }) => {
        if (["blocked", "failed"].includes(outcome)) {
          autoPlayedQuestions.current.delete(playKey);
        }
      });
      return;
    }
    void player().play(audioUrl, purpose);
  }, [clearAutoPlayTimer, input.promptAudioUrl, playKey, playPromptUntilEnded, player]);

  const stopAudio = useCallback(() => {
    clearAutoPlayTimer();
    playerRef.current?.stop();
  }, [clearAutoPlayTimer]);

  return {
    playAudio,
    stopAudio,
  };
}
