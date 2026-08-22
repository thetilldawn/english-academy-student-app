import {
  assignmentScopeLabel,
  type AssignmentHistorySource,
} from "@/lib/admin/history";

import styles from "./assignment-meta-tags.module.css";

export function AssignmentMetaTags({
  assignmentPurpose,
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
  const rangeLabel = assignmentScopeLabel({
    assignmentPurpose,
    primaryUnitLabels,
    questionCount,
    unitLabels,
  });

  return (
    <span aria-label="단어장과 범위" className={styles.root}>
      <span className={styles.dataset}>{datasetTitle}</span>
      <span aria-hidden="true" className={styles.separator}>·</span>
      <span className={styles.range}>{rangeLabel}</span>
    </span>
  );
}
