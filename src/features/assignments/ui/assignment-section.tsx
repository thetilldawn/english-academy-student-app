import type { ReactNode } from "react";

import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";

import styles from "./assignment-section.module.css";

export function AssignmentSection({
  children,
  help,
  helpLabel,
  index,
  title,
}: {
  children: ReactNode;
  help?: ReactNode;
  helpLabel?: string;
  index: number;
  title: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.heading}>
        <span aria-hidden="true" className={styles.index}>
          {index}
        </span>
        <h3>
          {help && helpLabel ? (
            <HelpTip label={helpLabel} trigger={title}>{help}</HelpTip>
          ) : title}
        </h3>
      </div>
      {children}
    </section>
  );
}
