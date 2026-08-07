"use client";

import { useMemo, useState } from "react";

import { AdminHistoryActions } from "@/components/admin-history-actions";
import { AdminHistoryList } from "@/components/admin-history-list";
import { AssignmentMetaTags } from "@/components/admin-meta-tags";
import {
  AttemptScoreSummary,
  AttemptStatusLabel,
} from "@/components/attempt-score-summary";
import {
  assignmentDisplayTitle,
  type AssignmentHistorySummary,
} from "@/lib/admin/history";
import {
  learningActivityEffectiveAt,
  matchesLearningHistoryFilters,
  sortLearningActivities,
  type LearningHistoryPurposeFilter,
  type LearningHistoryStatusFilter,
} from "@/lib/admin/learning-activity";
import { formatKoreanDateTime } from "@/lib/format";

function activityTimeLabel(item: AssignmentHistorySummary) {
  if (item.status === "not_started") {
    return item.availableUntil
      ? `마감 ${formatKoreanDateTime(item.availableUntil)}`
      : `배정 ${formatKoreanDateTime(item.assignedAt)} · 마감 없음`;
  }
  if (item.status === "cancelled") {
    return `취소 ${formatKoreanDateTime(
      learningActivityEffectiveAt(item),
    )}`;
  }
  if (item.status === "missed") {
    return `미응시 마감 ${formatKoreanDateTime(
      learningActivityEffectiveAt(item),
    )}`;
  }
  if (item.status === "expired") {
    return `시간 종료 ${formatKoreanDateTime(
      learningActivityEffectiveAt(item),
    )}`;
  }
  if (item.completedAt) {
    return `종료 ${formatKoreanDateTime(item.completedAt)}`;
  }
  return `시작 ${formatKoreanDateTime(
    learningActivityEffectiveAt(item),
  )}`;
}

export function StudentLearningActivityList({
  emptyLabel = "배정되거나 완료된 학습이 없습니다.",
  filtersEnabled = false,
  initialLimit = 5,
  items,
}: {
  emptyLabel?: string;
  filtersEnabled?: boolean;
  initialLimit?: number;
  items: AssignmentHistorySummary[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [detailItemId, setDetailItemId] = useState("");
  const [filterNow] = useState(() => Date.now());
  const [purposeFilter, setPurposeFilter] =
    useState<LearningHistoryPurposeFilter>("all");
  const [statusFilter, setStatusFilter] =
    useState<LearningHistoryStatusFilter>("all");
  const [periodFilter, setPeriodFilter] = useState<"all" | "30" | "90" | "365">(
    "all",
  );
  const sorted = useMemo(() => {
    const periodDays = periodFilter === "all" ? null : Number(periodFilter);
    const since =
      periodDays === null ? null : filterNow - periodDays * 86_400_000;
    return sortLearningActivities(
      items.filter((item) =>
        matchesLearningHistoryFilters(item, {
          purpose: purposeFilter,
          status: statusFilter,
          since,
        }),
      ),
    );
  }, [filterNow, items, periodFilter, purposeFilter, statusFilter]);
  const visible = expanded ? sorted : sorted.slice(0, initialLimit);

  if (!filtersEnabled && sorted.length === 0) {
    return <div className="empty-state learning-activity-empty">{emptyLabel}</div>;
  }

  return (
    <>
      <div className="learning-activity-region">
      {filtersEnabled ? (
        <div aria-label="학습 내역 필터" className="learning-activity-filters">
          <label>
            <span>유형</span>
            <select
              onChange={(event) => {
                setPurposeFilter(
                  event.target.value as LearningHistoryPurposeFilter,
                );
                setExpanded(false);
              }}
              value={purposeFilter}
            >
              <option value="all">전체 유형</option>
              <option value="regular">일반 시험</option>
              <option value="mixed">틀린 단어 포함</option>
              <option value="review">오답 재시험</option>
            </select>
          </label>
          <label>
            <span>상태</span>
            <select
              onChange={(event) => {
                setStatusFilter(
                  event.target.value as LearningHistoryStatusFilter,
                );
                setExpanded(false);
              }}
              value={statusFilter}
            >
              <option value="all">전체 상태</option>
              <option value="open">진행 전·진행 중</option>
              <option value="needs_attention">미응시·미통과</option>
              <option value="completed">통과 완료</option>
              <option value="archived">취소·삭제</option>
            </select>
          </label>
          <label>
            <span>기간</span>
            <select
              onChange={(event) => {
                setPeriodFilter(
                  event.target.value as "all" | "30" | "90" | "365",
                );
                setExpanded(false);
              }}
              value={periodFilter}
            >
              <option value="all">전체 기간</option>
              <option value="30">최근 30일</option>
              <option value="90">최근 90일</option>
              <option value="365">최근 1년</option>
            </select>
          </label>
        </div>
      ) : null}
      {sorted.length === 0 ? (
        <div className="empty-state learning-activity-empty">
          {filtersEnabled ? "선택한 조건의 내역이 없습니다." : emptyLabel}
        </div>
      ) : (
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
              <AdminHistoryActions
                item={item}
                onViewDetail={() => setDetailItemId(item.id)}
                size="small"
              />
            </li>
          ))}
        </ol>
      )}
      {sorted.length > initialLimit && (
        <button
          aria-expanded={expanded}
          className="button button-quiet learning-activity-expand"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded
            ? `최근 ${initialLimit}개만 보기`
            : `전체 ${sorted.length}개 보기`}
        </button>
      )}
      </div>
      {detailItemId ? (
        <AdminHistoryList
          initialItemId={detailItemId}
          items={items}
          key={detailItemId}
          launcherOnly
          onLauncherClose={() => setDetailItemId("")}
        />
      ) : null}
    </>
  );
}
