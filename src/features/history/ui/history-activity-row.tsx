import {
  ActivityRow,
  NavigableRow,
} from "@/design-system/patterns/activity-row/activity-row";
import {
  assignmentDisplayTitle,
  type AssignmentHistorySummary,
} from "@/lib/admin/history";
import { historyDetailHref } from "@/lib/admin/history-route";

import {
  buildAttemptStatusPresentation,
  hasAttemptScoreContent,
} from "../presentation/attempt-presentation";
import { ActivityStatusTimeline } from "./activity-status-timeline";
import { AssignmentMetaTags } from "./assignment-meta-tags";
import { AttemptScoreSummary } from "./attempt-score-summary";
import styles from "./history-activity-row.module.css";

export function HistoryActivityRow({
  compact = false,
  item,
  showStudent = true,
  showScore = "always",
}: {
  compact?: boolean;
  item: AssignmentHistorySummary;
  showStudent?: boolean;
  showScore?: "always" | "meaningful";
}) {
  const displayTitle = assignmentDisplayTitle(item);
  const presentation = buildAttemptStatusPresentation(item);
  const scoreVisible =
    showScore === "always" ||
    item.initialScore !== null ||
    item.status === "missed" ||
    item.status === "expired";
  const scoreInput = {
    finalScore: item.finalScore,
    initialScore: item.initialScore,
    passed: item.passed,
    passingScore: item.passingScore,
    phase: item.phase,
    retryStartedAt: item.retryStartedAt,
    status: item.status,
  };
  const hasScoreContent =
    scoreVisible &&
    hasAttemptScoreContent(scoreInput, { compact });
  const ariaLabel = [
    showStudent ? item.studentName : null,
    displayTitle || item.datasetTitle,
    "상세",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <NavigableRow
      ariaLabel={ariaLabel}
      density={compact ? "compact" : "default"}
      href={historyDetailHref(item)}
      tone={presentation.tone}
    >
      <ActivityRow
        main={
          <>
            <span className={styles.titleLine}>
              {showStudent ? <strong>{item.studentName}</strong> : null}
              {displayTitle ? (
                <span className={styles.title}>{displayTitle}</span>
              ) : null}
            </span>
            <AssignmentMetaTags {...item} compact />
          </>
        }
        score={
          hasScoreContent ? (
            <AttemptScoreSummary compact={compact} {...scoreInput} />
          ) : undefined
        }
        timeline={<ActivityStatusTimeline item={item} />}
      />
    </NavigableRow>
  );
}
