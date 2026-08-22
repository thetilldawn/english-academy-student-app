import type { ReactNode, Ref } from "react";

import styles from "./detail-header.module.css";

export function DetailHeader({
  headingLevel = 2,
  metadata,
  subtitle,
  title,
  titleId,
  titleRef,
}: {
  headingLevel?: 1 | 2;
  metadata?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
  titleId: string;
  titleRef?: Ref<HTMLHeadingElement>;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";

  return (
    <div className={styles.header}>
      <Heading id={titleId} ref={titleRef} tabIndex={titleRef ? -1 : undefined}>
        {title}
      </Heading>
      {subtitle ? <p>{subtitle}</p> : null}
      {metadata ? <div className={styles.metadata}>{metadata}</div> : null}
    </div>
  );
}
