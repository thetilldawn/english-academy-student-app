import type { ReactNode } from "react";

import {
  assignmentTypeLabel,
  assignmentUnitRangeLabel,
  type AssignmentHistorySource,
} from "@/lib/admin/history";
import { formatContentText } from "@/content/format";
import { adminHistoryText } from "@/content/ko/admin-history";

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
  datasetTitle,
  primaryUnitLabels,
  questionCount,
  unitLabels,
}: Pick<
  AssignmentHistorySource,
  | "assignmentPurpose"
  | "datasetTitle"
  | "primaryUnitLabels"
  | "questionCount"
  | "unitLabels"
> & { compact?: boolean }) {
  const questionCountLabel = formatContentText(
    adminHistoryText.list.questionCount,
    { count: questionCount },
  );
  const rangeLabel =
    assignmentPurpose === "review"
      ? questionCountLabel
      : assignmentUnitRangeLabel({
          assignmentPurpose,
          primaryUnitLabels,
          unitLabels,
        });

  return (
    <MetaTagList className="assignment-meta-tags">
      <MetaTag>{datasetTitle}</MetaTag>
      <MetaTag>{assignmentTypeLabel(assignmentPurpose)}</MetaTag>
      <MetaTag>{rangeLabel}</MetaTag>
      {!compact && assignmentPurpose !== "review" ? (
        <MetaTag>{questionCountLabel}</MetaTag>
      ) : null}
    </MetaTagList>
  );
}
