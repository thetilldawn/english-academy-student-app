import type { ReactNode } from "react";

import styles from "./result-layout.module.css";

export function ResultLayout({
  header,
  primary,
  secondary,
  sidebar,
  summary,
}: {
  header: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  sidebar: ReactNode;
  summary?: ReactNode;
}) {
  return (
    <main className={styles.page} id="main-content">
      {header}
      {summary ? <div className={styles.summary}>{summary}</div> : null}
      <div className={styles.layout}>
        <div className={styles.primary}>{primary}</div>
        <aside className={styles.sidebar}>{sidebar}</aside>
      </div>
      {secondary ? <div className={styles.secondary}>{secondary}</div> : null}
    </main>
  );
}

export function ResultSection({
  children,
  count,
  heading,
  headingId,
}: {
  children: ReactNode;
  count: ReactNode;
  heading: string;
  headingId: string;
}) {
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <div className={styles.sectionHeading}>
        <h2 id={headingId}>{heading}</h2>
        {count}
      </div>
      {children}
    </section>
  );
}

export function ResultEmptyState({ children }: { children: ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}

export const resultLayoutStyles = {
  grid: styles.questionGrid,
  list: styles.questionList,
};
