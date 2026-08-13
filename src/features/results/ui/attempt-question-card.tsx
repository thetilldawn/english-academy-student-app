import type { ReactNode } from "react";

import styles from "./attempt-question-card.module.css";

export function AttemptQuestionCard({
  children,
  eyebrow,
  headingDetail,
  prompt,
  status,
  wrongLevel,
}: {
  children: ReactNode;
  eyebrow: string;
  headingDetail?: ReactNode;
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
          {headingDetail ? (
            <div className={styles.headingDetail}>{headingDetail}</div>
          ) : null}
        </div>
        {status}
      </div>
      {children}
    </article>
  );
}
