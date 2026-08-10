import Link from "next/link";
import type { ReactNode } from "react";
import {
  Checkbox,
} from "@/design-system/primitives/form/field";

export function ActivityRowContent({
  main,
  score,
  timeline,
}: {
  main: ReactNode;
  score?: ReactNode;
  timeline: ReactNode;
}) {
  return (
    <span className="activity-row-content">
      <span className="activity-row-main">{main}</span>
      {score ? <span className="activity-row-score">{score}</span> : null}
      <span className="activity-row-timeline">{timeline}</span>
    </span>
  );
}

export function OpenableListRow({
  ariaLabel,
  children,
  className = "",
  href,
}: {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  href: string;
}) {
  return (
    <Link
      aria-label={ariaLabel}
      className={["openable-list-row", className].filter(Boolean).join(" ")}
      href={href}
      scroll={false}
    >
      {children}
    </Link>
  );
}

export function SelectableListRow({
  actions,
  checked,
  checkboxId,
  children,
  className = "",
  disabled = false,
  href,
  openAriaLabel,
  onToggle,
  selectionAriaLabel,
}: {
  actions?: ReactNode;
  checked: boolean;
  checkboxId: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  href?: string;
  openAriaLabel?: string;
  onToggle: () => void;
  selectionAriaLabel: string;
}) {
  return (
    <article
      className={["selectable-list-row", className]
        .filter(Boolean)
        .join(" ")}
      data-selected={checked}
    >
      <label className="selectable-list-row-checkbox" htmlFor={checkboxId}>
        <Checkbox
          aria-label={selectionAriaLabel}
          checked={checked}
          disabled={disabled}
          id={checkboxId}
          onChange={onToggle}
        />
      </label>
      {href ? (
        <Link
          aria-label={openAriaLabel}
          className="selectable-list-row-content"
          href={href}
          scroll={false}
        >
          {children}
        </Link>
      ) : (
        <span className="selectable-list-row-content">{children}</span>
      )}
      {actions ? (
        <span className="selectable-list-row-actions">{actions}</span>
      ) : null}
    </article>
  );
}
