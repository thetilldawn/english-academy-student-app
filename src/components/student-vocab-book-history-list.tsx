import { MetaTag, MetaTagList } from "@/components/admin-meta-tags";
import {
  cataloguedDatasetDisplayLabel,
  type CataloguedDataset,
} from "@/lib/admin/dataset-catalog";
import type { StudentVocabBookHistory } from "@/lib/admin/student-vocab-book-history";
import { formatKoreanDateTime } from "@/lib/format";

function statusPresentation(item: StudentVocabBookHistory) {
  if (item.lastStatus === "in_progress") {
    return { label: "진행 중", tone: "warning" as const };
  }
  if (item.lastStatus === "expired") {
    return { label: "시간 종료", tone: "danger" as const };
  }
  return item.lastPassed
    ? { label: "통과", tone: "positive" as const }
    : { label: "미통과", tone: "danger" as const };
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
        <h3>학습한 단어장</h3>
        <span>{items.length}개</span>
      </div>
      {items.length === 0 ? (
        <div className="empty-state student-vocab-history-empty">
          아직 실제로 응시한 단어장이 없습니다.
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
                    {isCurrent ? <MetaTag>최근 단어장</MetaTag> : null}
                    <MetaTag tone={presentation.tone}>
                      {presentation.label}
                    </MetaTag>
                  </MetaTagList>
                </div>
                <dl className="student-vocab-history-facts">
                  <div>
                    <dt>마지막 범위</dt>
                    <dd>{item.lastScopeLabel}</dd>
                  </div>
                  <div>
                    <dt>최근 학습</dt>
                    <dd>{formatKoreanDateTime(item.lastActivityAt)}</dd>
                  </div>
                  <div>
                    <dt>응시</dt>
                    <dd>{item.attemptCount}회</dd>
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
