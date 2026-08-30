import {
  MetaTag,
  MetaTagList,
  StatusBadge,
} from "@/design-system/primitives/badge/badge";
import {
  cataloguedDatasetDisplayLabel,
  type CataloguedDataset,
} from "@/lib/admin/dataset-catalog";
import type { StudentVocabBookHistory } from "../../public-contracts";
import { formatKoreanDateTime } from "@/lib/format";
import { formatContentText } from "@/content/format";
import { adminStudentsText } from "@/content/ko/admin-students";
import { EmptyState } from "@/design-system/patterns/feedback/feedback";

import styles from "./student-vocab-book-history-list.module.css";

function statusPresentation(item: StudentVocabBookHistory) {
  if (item.lastStatus === "in_progress") {
    return {
      label: adminStudentsText.learning.wordbookHistory.inProgress,
      tone: "warning" as const,
    };
  }
  if (item.lastStatus === "expired") {
    return {
      label: adminStudentsText.learning.wordbookHistory.expired,
      tone: "danger" as const,
    };
  }
  return item.lastPassed
    ? {
        label: adminStudentsText.learning.wordbookHistory.passed,
        tone: "success" as const,
      }
    : {
        label: adminStudentsText.learning.wordbookHistory.failed,
        tone: "danger" as const,
      };
}

export function StudentVocabBookHistoryList({
  datasets,
  items,
}: {
  datasets: readonly CataloguedDataset[];
  items: readonly StudentVocabBookHistory[];
}) {
  const datasetById = new Map(datasets.map((dataset) => [dataset.id, dataset]));

  return (
    <section className={styles.section}>
      <div className={styles.headingRow}>
        <h3>{adminStudentsText.learning.wordbookHistory.title}</h3>
        <span className={styles.summary}>
          {formatContentText(adminStudentsText.learning.wordbookHistory.count, {
            count: items.length,
          })}
        </span>
      </div>
      {items.length === 0 ? (
        <EmptyState className={styles.empty}>
          {adminStudentsText.learning.wordbookHistory.empty}
        </EmptyState>
      ) : (
        <ol className={styles.list}>
          {items.map((item, index) => {
            const dataset = datasetById.get(item.datasetId);
            const presentation = statusPresentation(item);
            const isRecent = index === 0;
            return (
              <li
                className={styles.row}
                data-current={isRecent || undefined}
                key={item.datasetId}
              >
                <div className={styles.itemHeading}>
                  <strong>
                    {dataset
                      ? cataloguedDatasetDisplayLabel(dataset)
                      : item.datasetTitle}
                  </strong>
                  <MetaTagList>
                    {isRecent ? (
                      <MetaTag>
                        {adminStudentsText.learning.wordbookHistory.recent}
                      </MetaTag>
                    ) : null}
                    <StatusBadge tone={presentation.tone}>
                      {presentation.label}
                    </StatusBadge>
                  </MetaTagList>
                </div>
                <dl className={styles.facts}>
                  <div>
                    <dt>{adminStudentsText.learning.wordbookHistory.lastRange}</dt>
                    <dd>{item.lastScopeLabel}</dd>
                  </div>
                  <div>
                    <dt>{adminStudentsText.learning.wordbookHistory.recentStudy}</dt>
                    <dd>{formatKoreanDateTime(item.lastActivityAt)}</dd>
                  </div>
                  <div>
                    <dt>{adminStudentsText.learning.wordbookHistory.attempts}</dt>
                    <dd>
                      {formatContentText(
                        adminStudentsText.learning.wordbookHistory.attemptCount,
                        { count: item.attemptCount },
                      )}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
