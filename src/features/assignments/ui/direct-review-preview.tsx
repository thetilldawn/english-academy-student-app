import type { DirectReviewPreviewRow } from "../presentation/direct-review-view";
import styles from "./vocab-assignment-planner.module.css";

export function DirectReviewPreview({ rows }: { rows: readonly DirectReviewPreviewRow[] }) {
  return <dl className={styles.reviewPreview}>
    {rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
  </dl>;
}
