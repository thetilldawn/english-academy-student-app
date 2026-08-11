import type { ReactNode } from "react";

import styles from "./action-reason.module.css";

export function ActionWithReason({
  children,
  layout = "inline",
  reason,
}: {
  children: ReactNode;
  layout?: "inline" | "remaining-center";
  reason: string | null;
}) {
  return (
    <div className={styles.root} data-layout={layout}>
      {children}
      {reason ? (
        <small aria-live="polite" className={styles.reason} title={reason}>
          {reason}
        </small>
      ) : null}
    </div>
  );
}
