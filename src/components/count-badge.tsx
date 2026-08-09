import type { ReactNode } from "react";

export function CountBadge({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={["count-badge", className].filter(Boolean).join(" ")}
    >
      {children}
    </span>
  );
}
