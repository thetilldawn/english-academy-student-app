import { formatContentText } from "@/content/format";
import { studentAppText } from "@/content/ko/student-app";
import { PronunciationText } from "@/components/pronunciation-text";

import type { QuizChoiceLength, QuizChoicePresentation } from "../domain/quiz-session";
import { AudioButton } from "@/design-system/patterns/audio-button/audio-button";
import styles from "./quiz-choice.module.css";

export type QuizChoiceFeedback = "correct" | "selected" | "wrong" | null;

export function QuizChoice({
  content,
  density,
  disabled,
  feedback,
  index,
  onChoose,
  onPlayAudio,
}: {
  content: QuizChoicePresentation;
  density: QuizChoiceLength;
  disabled: boolean;
  feedback: QuizChoiceFeedback;
  index: number;
  onChoose: () => void;
  onPlayAudio: () => void;
}) {
  const isEnglish = content.kind === "english-word";
  const pronunciation = isEnglish ? content.pronunciation : undefined;
  const audioEnabled = content.audioUrl !== null;
  const choice = content.text;
  return (
    <div
      className={[
        styles.row,
        audioEnabled ? styles.withAudio : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        className={[
          styles.choice,
          isEnglish ? styles.english : styles.korean,
          styles[density],
          feedback === "selected" ? styles.selected : "",
          feedback === "correct" ? styles.correct : "",
          feedback === "wrong" ? styles.wrong : "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled}
        data-feedback={feedback ?? "idle"}
        onClick={onChoose}
        type="button"
      >
        <span className={styles.number}>{index + 1}</span>
        <span className={styles.copy}>
          <span className={styles.text}>{choice}</span>
          {pronunciation?.displayKo ? (
            <PronunciationText
              className={styles.pronunciation}
              pronunciation={pronunciation}
            />
          ) : null}
        </span>
        <span aria-hidden="true" className={styles.mark}>
          {feedback === "correct"
            ? "✓"
            : feedback === "wrong"
              ? "×"
              : ""}
        </span>
      </button>
      {audioEnabled ? (
        <AudioButton
          disabled={disabled}
          label={formatContentText(
            studentAppText.attempt.pronunciationAria,
            { word: choice },
          )}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onPlayAudio();
          }}
          variant="choice"
        />
      ) : null}
    </div>
  );
}
