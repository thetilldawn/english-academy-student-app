import type { ReactNode } from "react";

import styles from "./action-reason.module.css";

export function ActionWithReason({
  children,
  layout = "inline",
  reason,
  reasonId,
}: {
  children: ReactNode;
  layout?: "inline" | "remaining-center";
  reason: string | null;
  reasonId?: string;
}) {
  return (
    <div className={styles.root} data-layout={layout}>
      {children}
      {reason ? (
        <small
          aria-live="polite"
          className={styles.reason}
          id={reasonId}
          title={reason}
        >
          {reason}
        </small>
      ) : null}
    </div>
  );
}
