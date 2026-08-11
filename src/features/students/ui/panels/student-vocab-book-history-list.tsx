import {
  MetaTag,
  MetaTagList,
  StatusBadge,
} from "@/design-system/primitives/badge/badge";
import {
  cataloguedDatasetDisplayLabel,
  type CataloguedDataset,
} from "@/lib/admin/dataset-catalog";
import type { StudentVocabBookHistory } from "@/lib/admin/student-vocab-book-history";
import { formatKoreanDateTime } from "@/lib/format";
import { formatContentText } from "@/content/format";
import { adminStudentsText } from "@/content/ko/admin-students";

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
  currentDatasetId,
  datasets,
  items,
}: {
  currentDatasetId: string | null;
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
        <div className={`empty-state ${styles.empty}`}>
          {adminStudentsText.learning.wordbookHistory.empty}
        </div>
      ) : (
        <ol className={styles.list}>
          {items.map((item) => {
            const dataset = datasetById.get(item.datasetId);
            const presentation = statusPresentation(item);
            const isCurrent = item.datasetId === currentDatasetId;
            return (
              <li
                className={styles.row}
                data-current={isCurrent || undefined}
                key={item.datasetId}
              >
                <div className={styles.itemHeading}>
                  <strong>
                    {dataset
                      ? cataloguedDatasetDisplayLabel(dataset)
                      : item.datasetTitle}
                  </strong>
                  <MetaTagList>
                    {isCurrent ? (
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
