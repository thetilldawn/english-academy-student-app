import type { ReactNode } from "react";

export function HelpTip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="help-tip">
      <button
        aria-label={label}
        className="help-tip-button"
        type="button"
      >
        ?
      </button>
      <span className="help-tip-content" role="tooltip">
        {children}
      </span>
    </span>
  );
}
