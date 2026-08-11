import type { ReactNode } from "react";

import styles from "./action-reason.module.css";

export function ActionWithReason({
  children,
  reason,
}: {
  children: ReactNode;
  reason: string | null;
}) {
  return (
    <div className={styles.root}>
      {children}
      {reason ? (
        <small aria-live="polite" className={styles.reason} title={reason}>
          {reason}
        </small>
      ) : null}
    </div>
  );
}
