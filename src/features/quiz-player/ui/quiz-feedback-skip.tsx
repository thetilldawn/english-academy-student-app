import { studentAppText } from "@/content/ko/student-app";

import styles from "./quiz-player.module.css";

export function QuizFeedbackSkip({
  visible,
  onInterrupt,
}: {
  visible: boolean;
  onInterrupt: () => void;
}) {
  if (!visible) return null;
  return (
    <button
      className={styles.feedbackSkip}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onInterrupt();
      }}
      type="button"
    >
      <span className={styles.feedbackSkipHint}>
        {studentAppText.attempt.skipAudio}
      </span>
    </button>
  );
}
