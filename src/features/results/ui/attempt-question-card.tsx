import type { ReactNode } from "react";

import styles from "./attempt-question-card.module.css";

export function AttemptQuestionCard({
  children,
  eyebrow,
  prompt,
  status,
  wrongLevel,
}: {
  children: ReactNode;
  eyebrow: string;
  prompt: string;
  status?: ReactNode;
  wrongLevel?: 1 | 2;
}) {
  return (
    <article className={styles.card} data-wrong-level={wrongLevel}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h3>{prompt}</h3>
        </div>
        {status}
      </div>
      {children}
    </article>
  );
}
