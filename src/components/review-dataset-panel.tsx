import { MetaTag, MetaTagList } from "@/components/admin-meta-tags";
import { HelpTip } from "@/components/help-tip";
import { adminLearningText } from "@/content/ko/admin-learning";
import type { ReviewDatasetSummary } from "@/lib/services/admin-service";

export function ReviewDatasetPanel({
  datasets,
}: {
  datasets: ReviewDatasetSummary[];
}) {
  if (datasets.length === 0) return null;

  return (
    <section
      aria-labelledby="review-dataset-heading"
      className="section review-dataset-section"
    >
      <div className="section-heading">
        <h2 className="label-with-help" id="review-dataset-heading">
          {adminLearningText.reviewDatasetPanel.title}
          <HelpTip label="단어장 검토 도움말">
            {adminLearningText.reviewDatasetPanel.help}
          </HelpTip>
        </h2>
      </div>
      <div className="review-dataset-list">
        {datasets.map((dataset) => {
          const hiddenCount = Math.max(
            0,
            dataset.rowCount - dataset.visibleEntryCount,
          );
          return (
            <article className="review-dataset-card" key={dataset.id}>
              <div className="review-dataset-heading">
                <div>
                  <h3>{dataset.title}</h3>
                  {dataset.edition && <p>{dataset.edition}</p>}
                </div>
                <MetaTagList>
                  <MetaTag tone="warning">검토 전용</MetaTag>
                  <MetaTag>{dataset.rowCount}개</MetaTag>
                </MetaTagList>
              </div>
              <p className="review-dataset-gate">
                원문 내용 검토 완료 · 단어 사전 연결 및 발음 승인 전
              </p>
              <ol className="review-entry-list">
                {dataset.entries.map((entry) => (
                  <li key={entry.id}>
                    <span aria-hidden="true" className="review-entry-number">
                      {String(entry.sourceRow).padStart(2, "0")}
                    </span>
                    <strong>{entry.headword}</strong>
                    <span>{entry.primaryMeaning}</span>
                  </li>
                ))}
              </ol>
              {hiddenCount > 0 && (
                <p className="list-meta">외 {hiddenCount}개는 다음 검토 묶음</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
