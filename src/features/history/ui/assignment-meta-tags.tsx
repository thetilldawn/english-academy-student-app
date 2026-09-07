import {
  assignmentScopeLabel,
  type AssignmentHistorySource,
} from "@/lib/admin/history";
import { MetaTag } from "@/design-system/primitives/badge/badge";

import styles from "./assignment-meta-tags.module.css";

export function AssignmentMetaTags({
  assignmentPurpose,
  datasetTitle,
  datasetAppearance = "text",
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
> & { compact?: boolean; datasetAppearance?: "text" | "badge" }) {
  const rangeLabel = assignmentScopeLabel({
    assignmentPurpose,
    primaryUnitLabels,
    questionCount,
    unitLabels,
  });

  return (
    <span aria-label="단어장과 범위" className={styles.root} data-dataset-appearance={datasetAppearance} role="group">
      {datasetAppearance === "badge" ? (
        <MetaTag className={styles.datasetBadge} overflow="wrap" size="default" tone="neutral">
          {datasetTitle}
        </MetaTag>
      ) : (
        <>
          <span className={styles.dataset}>{datasetTitle}</span>
          <span aria-hidden="true" className={styles.separator}>·</span>
        </>
      )}
      <span className={styles.range}>{rangeLabel}</span>
    </span>
  );
}
