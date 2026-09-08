import {
  ActivityRow,
  NavigableRow,
  type NavigableRowLinkComponent,
} from "@/design-system/patterns/activity-row/activity-row";
import {
  assignmentDisplayTitle,
} from "@/lib/admin/history";
import type { AdminHistoryListItem } from "@/features/history/contracts/admin-history-read-model";
import { historyDetailHref } from "@/lib/admin/history-route";

import {
  buildAttemptStatusPresentation,
  hasAttemptScoreContent,
} from "../presentation/attempt-presentation";
import { ActivityStatusTimeline } from "./activity-status-timeline";
import { AssignmentMetaTags } from "./assignment-meta-tags";
import { AttemptScoreSummary } from "./attempt-score-summary";
import styles from "./history-activity-row.module.css";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";

export function HistoryActivityRow({
  compact = false,
  item,
  linkComponent,
  showStudent = true,
  showScore = "always",
}: {
  compact?: boolean;
  item: AdminHistoryListItem;
  linkComponent?: NavigableRowLinkComponent;
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
  const detailHref = historyDetailHref(item);

  return (
    <NavigableRow
      ariaLabel={ariaLabel}
      density={compact ? "compact" : "default"}
      href={detailHref}
      linkComponent={linkComponent}
      prefetch={false}
      tone={presentation.tone}
    >
      <ActivityRow
        main={
          <>
            <span className={styles.titleLine}>
              {showStudent ? <span className={styles.studentIdentity}>
                <strong>{item.studentName}</strong>
                {(item.schoolName !== undefined || item.gradeLabel !== undefined) && item.studentName !== "삭제됨" ? <MetaTagList>
                  <MetaTag>{item.schoolName || "학교 미등록"}</MetaTag>
                  <MetaTag>{item.gradeLabel || "학년 미등록"}</MetaTag>
                </MetaTagList> : null}
              </span> : null}
              {displayTitle ? (
                <span className={styles.title}>{displayTitle}</span>
              ) : null}
            </span>
            <AssignmentMetaTags {...item} compact datasetAppearance="badge" />
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
