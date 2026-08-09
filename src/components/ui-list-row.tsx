import Link from "next/link";
import type { ReactNode } from "react";

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
  ariaLabel,
  checked,
  checkboxId,
  children,
  className = "",
  disabled = false,
  onToggle,
}: {
  actions: ReactNode;
  ariaLabel: string;
  checked: boolean;
  checkboxId: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <article
      className={["selectable-list-row", className]
        .filter(Boolean)
        .join(" ")}
      data-selected={checked}
    >
      <label className="selectable-list-row-checkbox" htmlFor={checkboxId}>
        <input
          aria-hidden="true"
          checked={checked}
          disabled={disabled}
          id={checkboxId}
          onChange={onToggle}
          tabIndex={-1}
          type="checkbox"
        />
      </label>
      <button
        aria-label={ariaLabel}
        aria-pressed={checked}
        className="selectable-list-row-content"
        disabled={disabled}
        onClick={onToggle}
        type="button"
      >
        {children}
      </button>
      <span className="selectable-list-row-actions">{actions}</span>
    </article>
  );
}
