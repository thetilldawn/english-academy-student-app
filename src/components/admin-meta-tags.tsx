import type { ReactNode } from "react";

import {
  assignmentTypeLabel,
  assignmentUnitRangeLabel,
  type AssignmentHistorySource,
} from "@/lib/admin/history";

type MetaTagTone = "neutral" | "positive" | "warning" | "danger";

export function MetaTagList({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={["meta-tag-list", className].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}

export function MetaTag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: MetaTagTone;
}) {
  return (
    <span className="meta-tag" data-tone={tone}>
      {children}
    </span>
  );
}

export function AssignmentMetaTags({
  assignmentPurpose,
  compact = false,
  primaryUnitLabels,
  questionCount,
  unitLabels,
}: Pick<
  AssignmentHistorySource,
  | "assignmentPurpose"
  | "primaryUnitLabels"
  | "questionCount"
  | "unitLabels"
> & { compact?: boolean }) {
  return (
    <MetaTagList className="assignment-meta-tags">
      <MetaTag>{assignmentTypeLabel(assignmentPurpose)}</MetaTag>
      <MetaTag>
        {assignmentUnitRangeLabel({
          assignmentPurpose,
          primaryUnitLabels,
          unitLabels,
        })}
      </MetaTag>
      {!compact ? <MetaTag>{questionCount}문항</MetaTag> : null}
    </MetaTagList>
  );
}
