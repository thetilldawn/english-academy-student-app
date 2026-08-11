import { formatContentText } from "@/content/format";
import { studentAppText } from "@/content/ko/student-app";

import type { QuizChoiceLength } from "../domain/quiz-session";
import type { QuizPronunciation } from "../model";
import { AudioButton } from "./audio-button";
import styles from "./quiz-choice.module.css";

export type QuizChoiceFeedback = "correct" | "wrong" | null;

export function QuizChoice({
  audioEnabled,
  choice,
  density,
  disabled,
  feedback,
  index,
  isEnglish,
  onChoose,
  onPlayAudio,
  pronunciation,
}: {
  audioEnabled: boolean;
  choice: string;
  density: QuizChoiceLength;
  disabled: boolean;
  feedback: QuizChoiceFeedback;
  index: number;
  isEnglish: boolean;
  onChoose: () => void;
  onPlayAudio: () => void;
  pronunciation: QuizPronunciation;
}) {
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
          feedback === "correct" ? styles.correct : "",
          feedback === "wrong" ? styles.wrong : "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled}
        onClick={onChoose}
        type="button"
      >
        <span className={styles.number}>{index + 1}</span>
        <span className={styles.copy}>
          <span className={styles.text}>{choice}</span>
          {isEnglish && pronunciation.displayKo ? (
            <small className={styles.pronunciation}>
              {pronunciation.displayKo}
            </small>
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
