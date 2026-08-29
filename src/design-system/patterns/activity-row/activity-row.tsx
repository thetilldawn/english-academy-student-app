import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { Checkbox } from "../../primitives/form/field";

import styles from "./activity-row.module.css";

export type ActivityRowTone = "neutral" | "success" | "warning" | "danger";

export type NavigableRowLinkComponent = ComponentType<{
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
  "data-tone"?: ActivityRowTone;
  href: string;
  scroll?: boolean;
}>;

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function ActivityRow({
  main,
  score,
  timeline,
}: {
  main: ReactNode;
  score?: ReactNode;
  timeline?: ReactNode;
}) {
  const hasScore = Boolean(score);
  const hasTimeline = Boolean(timeline);

  return (
    <span
      className={styles.content}
      data-has-score={hasScore}
      data-has-timeline={hasTimeline}
    >
      <span className={styles.main}>{main}</span>
      {score ? <span className={styles.score}>{score}</span> : null}
      {timeline ? <span className={styles.timeline}>{timeline}</span> : null}
    </span>
  );
}

export function NavigableRow({
  ariaLabel,
  children,
  density = "default",
  href,
  linkComponent,
  tone = "neutral",
}: {
  ariaLabel?: string;
  children: ReactNode;
  density?: "compact" | "default";
  href: string;
  linkComponent?: NavigableRowLinkComponent;
  tone?: ActivityRowTone;
}) {
  const LinkComponent = linkComponent ?? Link;
  return (
    <LinkComponent
      aria-label={ariaLabel}
      className={classNames(
        styles.navigable,
        density === "compact" && styles.compact,
      )}
      data-tone={tone}
      href={href}
      scroll={false}
    >
      {children}
    </LinkComponent>
  );
}

export function SelectableRow({
  actions,
  checked,
  checkboxId,
  children,
  contentHref,
  disabled = false,
  onToggle,
  selectionEnabled = true,
  selectionAriaLabel,
}: {
  actions?: ReactNode;
  checked: boolean;
  checkboxId: string;
  children: ReactNode;
  contentHref?: string;
  disabled?: boolean;
  onToggle: () => void;
  selectionEnabled?: boolean;
  selectionAriaLabel: string;
}) {
  return (
    <article
      className={styles.selectable}
      data-selected={selectionEnabled && checked}
      data-selection-enabled={selectionEnabled}
    >
      {selectionEnabled ? (
        <label className={styles.selectableToggle} htmlFor={checkboxId}>
          <span className={styles.checkbox}>
            <Checkbox
              aria-label={selectionAriaLabel}
              checked={checked}
              disabled={disabled}
              id={checkboxId}
              onChange={onToggle}
            />
          </span>
          <span className={styles.selectableContent}>{children}</span>
        </label>
      ) : contentHref ? (
        <Link
          className={styles.selectableContent}
          href={contentHref}
          scroll={false}
        >
          {children}
        </Link>
      ) : (
        <span className={styles.selectableContent}>{children}</span>
      )}
      {actions ? <span className={styles.actions}>{actions}</span> : null}
    </article>
  );
}
