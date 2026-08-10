import { MetaTag, MetaTagList } from "@/components/admin-meta-tags";
import { StatusBadge } from "@/components/status-badge";
import {
  cataloguedDatasetDisplayLabel,
  type CataloguedDataset,
} from "@/lib/admin/dataset-catalog";
import type { StudentVocabBookHistory } from "@/lib/admin/student-vocab-book-history";
import { formatKoreanDateTime } from "@/lib/format";
import { formatContentText } from "@/content/format";
import { adminStudentsText } from "@/content/ko/admin-students";

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
    <section className="student-vocab-history">
      <div className="learning-section-heading">
        <h3>{adminStudentsText.learning.wordbookHistory.title}</h3>
        <span className="learning-section-summary">
          {formatContentText(adminStudentsText.learning.wordbookHistory.count, {
            count: items.length,
          })}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="empty-state student-vocab-history-empty">
          {adminStudentsText.learning.wordbookHistory.empty}
        </div>
      ) : (
        <ol className="student-vocab-history-list">
          {items.map((item) => {
            const dataset = datasetById.get(item.datasetId);
            const presentation = statusPresentation(item);
            const isCurrent = item.datasetId === currentDatasetId;
            return (
              <li
                className="student-vocab-history-row"
                data-current={isCurrent || undefined}
                key={item.datasetId}
              >
                <div className="student-vocab-history-heading">
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
                <dl className="student-vocab-history-facts">
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
