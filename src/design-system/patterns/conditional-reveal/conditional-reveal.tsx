"use client";

import type { ReactNode } from "react";

import styles from "./conditional-reveal.module.css";

function classNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function ConditionalReveal({
  children,
  className,
  open,
}: {
  children: ReactNode;
  className?: string;
  open: boolean;
}) {
  return (
    <div
      aria-hidden={!open}
      className={classNames(styles.reveal, className)}
      data-open={open}
      inert={!open}
    >
      <div className={styles.content}>{children}</div>
    </div>
  );
}
