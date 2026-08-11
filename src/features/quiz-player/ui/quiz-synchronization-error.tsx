import { studentAppText } from "@/content/ko/student-app";
import { Button } from "@/design-system/primitives/button/button";

import styles from "./quiz-synchronization-error.module.css";

export function QuizSynchronizationError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  if (!message) return null;

  return (
    <div className={styles.error} role="alert">
      <span>{message}</span>
      {onRetry ? (
        <Button onClick={onRetry} size="small" variant="secondary">
          {studentAppText.attempt.synchronizationRetry}
        </Button>
      ) : null}
    </div>
  );
}
