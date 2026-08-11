import type { HTMLAttributes, ReactNode } from "react";

import styles from "./feedback.module.css";

function classNames(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

export function Notice({
  children,
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  tone?: "neutral" | "warning" | "danger" | "success";
}) {
  return (
    <div
      className={classNames(styles.notice, className)}
      data-tone={tone}
      {...props}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={classNames(styles.empty, className)} {...props}>
      {children}
    </div>
  );
}

export function InlineError({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode }) {
  return (
    <span
      className={classNames(styles.inlineError, className)}
      role="alert"
      {...props}
    >
      {children}
    </span>
  );
}
