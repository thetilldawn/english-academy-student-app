import { studentAppText } from "@/content/ko/student-app";

import styles from "./quiz-frame.module.css";

export function QuizTimeoutOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      aria-hidden="true"
      className={styles.timeoutOverlay}
      data-testid="quiz-timeout-overlay"
    >
      <strong className={styles.timeoutMessage}>
        {studentAppText.attempt.timeoutTitle}
      </strong>
    </div>
  );
}
