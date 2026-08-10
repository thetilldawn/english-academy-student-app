import type { HTMLAttributes, ReactNode } from "react";

import styles from "./badge.module.css";
import type { StatusTone } from "./tone";

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

export type BadgeSize = "small" | "default" | "large";

export function StatusBadge({
  children,
  className,
  size = "default",
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  size?: Exclude<BadgeSize, "large">;
  tone?: StatusTone;
}) {
  return (
    <span
      className={classNames(
        styles.badge,
        styles.status,
        styles[size],
        className,
      )}
      data-tone={tone}
      {...props}
    >
      {children}
    </span>
  );
}

export function CountBadge({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode }) {
  return (
    <span
      className={classNames(styles.badge, styles.status, styles.default, className)}
      data-tone="neutral"
      {...props}
    >
      {children}
    </span>
  );
}

export type MetaTagTone = StatusTone;

export function MetaTag({
  children,
  className,
  overflow = "wrap",
  size = "small",
  tone = "neutral",
  width = "content",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  overflow?: "wrap" | "truncate";
  size?: BadgeSize;
  tone?: MetaTagTone;
  width?: "content" | "container";
}) {
  return (
    <span
      className={classNames(
        styles.badge,
        styles.meta,
        styles[size],
        overflow === "truncate" && styles.truncate,
        width === "container" && styles.container,
        className,
      )}
      data-tone={tone}
      {...props}
    >
      {children}
    </span>
  );
}

export function MetaTagList({
  children,
  className,
  fullWidth = false,
  gap = "compact",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  fullWidth?: boolean;
  gap?: "compact" | "default";
}) {
  return (
    <span
      className={classNames(
        styles.list,
        gap === "default" && styles.listDefaultGap,
        fullWidth && styles.listFullWidth,
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
