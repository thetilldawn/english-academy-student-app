import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import {
  HelpTip,
  inlineHelpClassName,
} from "@/design-system/primitives/tooltip/help-tip";
import { adminLearningText } from "@/content/ko/admin-learning";
import { formatContentText } from "@/content/format";
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
        <h2 className={inlineHelpClassName} id="review-dataset-heading">
          {adminLearningText.reviewDatasetPanel.title}
          <HelpTip label={adminLearningText.reviewDatasetPanel.helpAria}>
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
                  <MetaTag tone="warning">
                    {adminLearningText.reviewDatasetPanel.reviewOnly}
                  </MetaTag>
                  <MetaTag>
                    {formatContentText(
                      adminLearningText.reviewDatasetPanel.count,
                      { count: dataset.rowCount },
                    )}
                  </MetaTag>
                </MetaTagList>
              </div>
              <p className="review-dataset-gate">
                {adminLearningText.reviewDatasetPanel.status}
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
                <p className="list-meta">
                  {formatContentText(
                    adminLearningText.reviewDatasetPanel.hidden,
                    { count: hiddenCount },
                  )}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
