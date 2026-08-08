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
  learningActivitySection,
  matchesLearningHistoryFilters,
  sortLearningActivities,
  type LearningActivitySection,
  type LearningHistoryPurposeFilter,
  type LearningHistoryStatusFilter,
} from "@/lib/admin/learning-activity";
import { adminStudentsText } from "@/content/ko/admin-students";
import { formatContentText } from "@/content/format";
import { formatKoreanDateTime } from "@/lib/format";
import { SelectField } from "@/components/ui-select";
import { Button } from "@/components/ui-button";

function activityTimeLabel(item: AssignmentHistorySummary) {
  const copy = adminStudentsText.learning.activityList.time;
  if (item.status === "not_started") {
    return item.availableUntil
      ? formatContentText(copy.deadline, {
          datetime: formatKoreanDateTime(item.availableUntil),
        })
      : formatContentText(copy.assignedWithoutDeadline, {
          datetime: formatKoreanDateTime(item.assignedAt),
        });
  }
  if (item.status === "cancelled") {
    return formatContentText(copy.cancelled, {
      datetime: formatKoreanDateTime(learningActivityEffectiveAt(item)),
    });
  }
  if (item.status === "missed") {
    return formatContentText(copy.missed, {
      datetime: formatKoreanDateTime(learningActivityEffectiveAt(item)),
    });
  }
  if (item.status === "expired") {
    return formatContentText(copy.expired, {
      datetime: formatKoreanDateTime(learningActivityEffectiveAt(item)),
    });
  }
  if (item.completedAt) {
    return formatContentText(copy.finished, {
      datetime: formatKoreanDateTime(item.completedAt),
    });
  }
  if (item.status === "in_progress" && item.phase === "review") {
    return formatContentText(copy.failed, {
      datetime: formatKoreanDateTime(
        item.initialCompletedAt ?? item.startedAt,
      ),
    });
  }
  return formatContentText(copy.started, {
    datetime: formatKoreanDateTime(learningActivityEffectiveAt(item)),
  });
}

export function StudentLearningActivityList({
  emptyLabel = adminStudentsText.learning.activityList.empty,
  filtersEnabled = false,
  initialLimit = 5,
  items,
  onEditAssignment,
}: {
  emptyLabel?: string;
  filtersEnabled?: boolean;
  initialLimit?: number;
  items: AssignmentHistorySummary[];
  onEditAssignment?: (item: AssignmentHistorySummary) => void;
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
      items.filter(
        (item) =>
          (filtersEnabled ||
            learningActivitySection(item) !== "archived") &&
          matchesLearningHistoryFilters(item, {
            purpose: purposeFilter,
            status: statusFilter,
            since,
          }),
      ),
    );
  }, [
    filterNow,
    filtersEnabled,
    items,
    periodFilter,
    purposeFilter,
    statusFilter,
  ]);
  const visible = expanded ? sorted : sorted.slice(0, initialLimit);
  const sectionDefinitions: Array<{
    id: LearningActivitySection;
    label: string;
  }> = [
    { id: "open", label: adminStudentsText.learning.activitySections.open },
    {
      id: "needs_attention",
      label: adminStudentsText.learning.activitySections.needsAttention,
    },
    {
      id: "completed",
      label: adminStudentsText.learning.activitySections.completed,
    },
    ...(filtersEnabled
      ? [
          {
            id: "archived" as const,
            label: adminStudentsText.learning.activitySections.archived,
          },
        ]
      : []),
  ];
  const visibleSections = sectionDefinitions
    .map((section) => ({
      ...section,
      items: visible.filter(
        (item) => learningActivitySection(item) === section.id,
      ),
    }))
    .filter((section) => section.items.length > 0);

  if (!filtersEnabled && sorted.length === 0) {
    return <div className="empty-state learning-activity-empty">{emptyLabel}</div>;
  }

  return (
    <>
      <div className="learning-activity-region">
      {filtersEnabled ? (
        <div
          aria-label={adminStudentsText.learning.activityList.filterAria}
          className="learning-activity-filters"
        >
          <label>
            <span>{adminStudentsText.learning.activityList.filters.type}</span>
            <SelectField
              onChange={(event) => {
                setPurposeFilter(
                  event.target.value as LearningHistoryPurposeFilter,
                );
                setExpanded(false);
              }}
              value={purposeFilter}
            >
              <option value="all">{adminStudentsText.learning.activityList.filters.allTypes}</option>
              <option value="regular">{adminStudentsText.learning.activityList.filters.regular}</option>
              <option value="mixed">{adminStudentsText.learning.activityList.filters.mixed}</option>
              <option value="review">{adminStudentsText.learning.activityList.filters.review}</option>
            </SelectField>
          </label>
          <label>
            <span>{adminStudentsText.learning.activityList.filters.status}</span>
            <SelectField
              onChange={(event) => {
                setStatusFilter(
                  event.target.value as LearningHistoryStatusFilter,
                );
                setExpanded(false);
              }}
              value={statusFilter}
            >
              <option value="all">{adminStudentsText.learning.activityList.filters.allStatuses}</option>
              <option value="open">{adminStudentsText.learning.activityList.filters.open}</option>
              <option value="needs_attention">{adminStudentsText.learning.activityList.filters.needsAttention}</option>
              <option value="completed">{adminStudentsText.learning.activityList.filters.completed}</option>
              <option value="archived">{adminStudentsText.learning.activityList.filters.archived}</option>
            </SelectField>
          </label>
          <label>
            <span>{adminStudentsText.learning.activityList.filters.period}</span>
            <SelectField
              onChange={(event) => {
                setPeriodFilter(
                  event.target.value as "all" | "30" | "90" | "365",
                );
                setExpanded(false);
              }}
              value={periodFilter}
            >
              <option value="all">{adminStudentsText.learning.activityList.filters.allPeriods}</option>
              <option value="30">{adminStudentsText.learning.activityList.filters.recent30}</option>
              <option value="90">{adminStudentsText.learning.activityList.filters.recent90}</option>
              <option value="365">{adminStudentsText.learning.activityList.filters.recentYear}</option>
            </SelectField>
          </label>
        </div>
      ) : null}
      {sorted.length === 0 ? (
        <div className="empty-state learning-activity-empty">
          {filtersEnabled
            ? adminStudentsText.learning.activityList.noMatches
            : emptyLabel}
        </div>
      ) : (
        <div className="learning-activity-sections">
          {visibleSections.map((section) => (
            <section
              aria-labelledby={`learning-activity-${section.id}`}
              className="learning-activity-section"
              key={section.id}
            >
              <div className="learning-section-heading">
                <h4 id={`learning-activity-${section.id}`}>
                  {section.label}
                </h4>
                <span>
                  {formatContentText(
                    adminStudentsText.learning.activityList.count,
                    { count: section.items.length },
                  )}
                </span>
              </div>
              <ol className="learning-activity-list">
                {section.items.map((item) => (
                  <li className="learning-activity-row" key={item.id}>
                    <div className="learning-activity-main">
                      <strong>{assignmentDisplayTitle(item)}</strong>
                      <AssignmentMetaTags {...item} compact />
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
                      onEdit={onEditAssignment}
                      onViewDetail={() => setDetailItemId(item.id)}
                      size="small"
                      summaryOnly
                    />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
      {sorted.length > initialLimit && (
        <Button
          aria-expanded={expanded}
          className="learning-activity-expand"
          onClick={() => setExpanded((current) => !current)}
          variant="quiet"
        >
          {expanded
            ? formatContentText(
                adminStudentsText.learning.activityList.recentOnly,
                { count: initialLimit },
              )
            : formatContentText(
                adminStudentsText.learning.activityList.showAll,
                { count: sorted.length },
              )}
        </Button>
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
