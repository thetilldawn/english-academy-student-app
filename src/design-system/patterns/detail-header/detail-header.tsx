import type { ReactNode, Ref } from "react";

import styles from "./detail-header.module.css";

export function DetailHeader({
  metadata,
  subtitle,
  title,
  titleId,
  titleRef,
}: {
  metadata?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
  titleId: string;
  titleRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className={styles.header}>
      <h1 id={titleId} ref={titleRef} tabIndex={titleRef ? -1 : undefined}>
        {title}
      </h1>
      {subtitle ? <p>{subtitle}</p> : null}
      {metadata ? <div className={styles.metadata}>{metadata}</div> : null}
    </div>
  );
}
