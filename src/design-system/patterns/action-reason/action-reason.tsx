import type { ReactNode } from "react";

import styles from "./action-reason.module.css";

export function ActionWithReason({
  children,
  layout = "inline",
  reason,
  reasonId,
  reasonPosition = "after",
}: {
  children: ReactNode;
  layout?: "inline" | "remaining-center";
  reason: string | null;
  reasonId?: string;
  reasonPosition?: "before" | "after";
}) {
  const reasonNode = reason ? (
    <small
      aria-live="polite"
      className={styles.reason}
      id={reasonId}
      title={reason}
    >
      {reason}
    </small>
  ) : null;
  return (
    <div className={styles.root} data-layout={layout} data-reason-position={reasonPosition}>
      {reasonPosition === "before" ? reasonNode : null}
      {children}
      {reasonPosition === "after" ? reasonNode : null}
    </div>
  );
}
