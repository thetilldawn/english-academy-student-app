import type { ReactNode } from "react";

function classNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function AssignmentEditorLayout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={classNames("assignment-editor-layout", className)}>
      {children}
    </div>
  );
}

export function AssignmentEditorSettings({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={classNames("assignment-editor-settings", className)}>
      {children}
    </div>
  );
}

export function AssignmentEditorSummary({
  busy,
  children,
  className,
}: {
  busy?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside
      aria-busy={busy || undefined}
      className={classNames("assignment-editor-summary", className)}
    >
      {children}
    </aside>
  );
}

export function AssignmentFieldGrid({
  children,
  className,
  columns = 2,
}: {
  children: ReactNode;
  className?: string;
  columns?: 2 | 3;
}) {
  return (
    <div
      className={classNames(
        "assignment-field-grid",
        `assignment-field-grid--${columns}`,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AssignmentSessionRow({
  className,
  details,
  error,
  heading,
}: {
  className?: string;
  details: ReactNode;
  error?: ReactNode;
  heading: ReactNode;
}) {
  return (
    <div className={classNames("assignment-session-row", className)}>
      <div className="assignment-session-row-heading">{heading}</div>
      <div className="assignment-session-row-details">{details}</div>
      {error ? (
        <div className="assignment-session-row-error">{error}</div>
      ) : null}
    </div>
  );
}
