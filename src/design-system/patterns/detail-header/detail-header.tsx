import type { ReactNode } from "react";

import styles from "./detail-header.module.css";

export function DetailHeader({
  metadata,
  subtitle,
  title,
  titleId,
}: {
  metadata?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
  titleId: string;
}) {
  return (
    <div className={styles.header}>
      <h1 id={titleId}>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
      {metadata ? <div className={styles.metadata}>{metadata}</div> : null}
    </div>
  );
}
