"use client";

import { PronunciationText } from "@/components/pronunciation-text";
import { formatContentText } from "@/content/format";
import { studentAppText } from "@/content/ko/student-app";
import { AudioButton } from "@/design-system/patterns/audio-button/audio-button";
import type { QuizPronunciation } from "@/lib/quiz/pronunciation-snapshot";

import { useResultAudio } from "./result-audio-provider";
import styles from "./student-result-view.module.css";

export function ResultPronunciation({
  headword,
  pronunciation,
}: {
  headword: string;
  pronunciation: QuizPronunciation;
}) {
  const playAudio = useResultAudio();

  const audioUrl = pronunciation.available
    ? pronunciation.audioUrl
    : null;
  if (!pronunciation.displayKo && !audioUrl) return null;

  return (
    <div className={styles.resultPronunciation}>
      {pronunciation.displayKo ? (
        <PronunciationText
          className={styles.pronunciation}
          pronunciation={pronunciation}
        />
      ) : null}
      {audioUrl ? (
        <AudioButton
          label={formatContentText(
            studentAppText.attempt.pronunciationAria,
            { word: headword },
          )}
          onClick={() => {
            playAudio(audioUrl);
          }}
          variant="compact"
        />
      ) : null}
    </div>
  );
}
