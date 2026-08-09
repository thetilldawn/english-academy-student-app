import type { ReactNode } from "react";

import type { StatusTone } from "@/lib/ui/status";

export function StatusBadge({
  children,
  className = "",
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  tone?: StatusTone;
}) {
  return (
    <span
      className={["status-badge", className].filter(Boolean).join(" ")}
      data-tone={tone}
    >
      {children}
    </span>
  );
}
