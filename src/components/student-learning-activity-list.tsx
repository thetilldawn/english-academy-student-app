"use client";

import { useState } from "react";

import { AdminHistoryActions } from "@/components/admin-history-actions";
import { AssignmentMetaTags } from "@/components/admin-meta-tags";
import {
  AttemptScoreSummary,
  AttemptStatusLabel,
} from "@/components/attempt-score-summary";
import {
  assignmentDisplayTitle,
  type AssignmentHistorySummary,
} from "@/lib/admin/history";
import { sortLearningActivities } from "@/lib/admin/learning-activity";
import { formatKoreanDateTime } from "@/lib/format";

function activityTimeLabel(item: AssignmentHistorySummary) {
  if (item.status === "not_started") {
    return item.availableUntil
      ? `마감 ${formatKoreanDateTime(item.availableUntil)}`
      : `배정 ${formatKoreanDateTime(item.assignedAt)} · 마감 없음`;
  }
  if (item.status === "cancelled") {
    return `취소 ${formatKoreanDateTime(item.cancelledAt)}`;
  }
  if (item.status === "missed") {
    return `미응시 마감 ${formatKoreanDateTime(item.availableUntil)}`;
  }
  if (item.completedAt) {
    return `종료 ${formatKoreanDateTime(item.completedAt)}`;
  }
  return `시작 ${formatKoreanDateTime(item.startedAt)}`;
}

export function StudentLearningActivityList({
  emptyLabel = "배정되거나 완료된 학습이 없습니다.",
  initialLimit = 5,
  items,
}: {
  emptyLabel?: string;
  initialLimit?: number;
  items: AssignmentHistorySummary[];
}) {
  const [expanded, setExpanded] = useState(false);
  const sorted = sortLearningActivities(items);
  const visible = expanded ? sorted : sorted.slice(0, initialLimit);

  if (sorted.length === 0) {
    return <div className="empty-state learning-activity-empty">{emptyLabel}</div>;
  }

  return (
    <div className="learning-activity-region">
      <ol className="learning-activity-list">
        {visible.map((item) => (
          <li className="learning-activity-row" key={item.id}>
            <div className="learning-activity-main">
              <strong>{assignmentDisplayTitle(item)}</strong>
              <AssignmentMetaTags {...item} />
              <small>{activityTimeLabel(item)}</small>
            </div>
            <div className="learning-activity-result">
              <AttemptScoreSummary
                finalScore={item.finalScore}
                initialScore={item.initialScore}
                passingScore={item.passingScore}
                phase={item.phase}
                retryStartedAt={item.retryStartedAt}
                status={item.status}
              />
              <AttemptStatusLabel
                finalScore={item.finalScore}
                initialScore={item.initialScore}
                passingScore={item.passingScore}
                phase={item.phase}
                retryStartedAt={item.retryStartedAt}
                status={item.status}
              />
            </div>
            <AdminHistoryActions item={item} size="small" />
          </li>
        ))}
      </ol>
      {sorted.length > initialLimit && (
        <button
          aria-expanded={expanded}
          className="button button-quiet learning-activity-expand"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? "최근 5개만 보기" : `전체 ${sorted.length}개 보기`}
        </button>
      )}
    </div>
  );
}
