import type { ReactNode } from "react";

import styles from "./student-wrong-word-panel.module.css";

export function WrongWordControlSection({
  children,
  selection = false,
  title,
  titleId,
}: {
  children: ReactNode;
  selection?: boolean;
  title: string;
  titleId: string;
}) {
  return (
    <section
      aria-labelledby={titleId}
      className={selection ? styles.selectionSection : styles.controlSection}
    >
      <h4 id={titleId}>{title}</h4>
      {children}
    </section>
  );
}
