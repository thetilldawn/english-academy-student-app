import { learningPointsText } from "@/content/ko/learning-points";

import { formatVisiblePoints } from "../presentation/point-presentation";
import styles from "./header-point-summary.module.css";

type HeaderPointSummaryProps =
  | { currentPoints: number; state?: "ready" }
  | { currentPoints?: never; state: "loading" | "unavailable" };

export function HeaderPointSummary(props: HeaderPointSummaryProps) {
  const value = typeof props.currentPoints === "number"
    ? formatVisiblePoints(props.currentPoints)
    : props.state === "loading"
      ? learningPointsText.header.loading
      : learningPointsText.header.unavailable;

  return (
    <span
      aria-atomic="true"
      aria-busy={props.state === "loading" || undefined}
      className={styles.summary}
      data-header-points={props.state ?? "ready"}
      role="status"
    >
      <span>{learningPointsText.header.label}</span>
      <strong className={styles.value}>{value}</strong>
    </span>
  );
}
