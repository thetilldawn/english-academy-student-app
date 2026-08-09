"use client";

import { useMemo, useState } from "react";

import { ActivityStatusTimeline } from "@/components/activity-status-timeline";
import { AssignmentMetaTags } from "@/components/admin-meta-tags";
import { AttemptScoreSummary } from "@/components/attempt-score-summary";
import {
  ActivityRowContent,
  OpenableListRow,
} from "@/components/ui-list-row";
import { SelectField } from "@/components/ui-select";
import { adminHistoryText } from "@/content/ko/admin-history";
import {
  assignmentDisplayTitle,
  type AssignmentHistorySummary,
} from "@/lib/admin/history";
import { historyDetailHref } from "@/lib/admin/history-route";
import {
  compareLearningActivities,
  learningActivitySection,
} from "@/lib/admin/learning-activity";
import { buildAttemptStatusPresentation } from "@/lib/ui/attempt-score-presentation";

type HistoryStatusFilter =
  | "all"
  | "open"
  | "needs_attention"
  | "completed"
  | "retried"
  | "archived";

function statusPresentation(item: AssignmentHistorySummary) {
  return buildAttemptStatusPresentation(item);
}

function HistoryRowContent({
  compact,
  item,
}: {
  compact: boolean;
  item: AssignmentHistorySummary;
}) {
  return (
    <ActivityRowContent
      main={
        <>
          <span className="activity-row-title-line">
            <strong>{item.studentName}</strong>
            <span className="activity-row-title">
              {assignmentDisplayTitle(item)}
            </span>
          </span>
          <AssignmentMetaTags {...item} compact />
        </>
      }
      score={
        !compact ||
        item.initialScore !== null ||
        item.status === "missed" ||
        item.status === "expired" ? (
          <AttemptScoreSummary
            compact
            finalScore={item.finalScore}
            initialScore={item.initialScore}
            passingScore={item.passingScore}
            phase={item.phase}
            retryStartedAt={item.retryStartedAt}
            status={item.status}
          />
        ) : undefined
      }
      timeline={<ActivityStatusTimeline item={item} />}
    />
  );
}

export function AdminHistoryList({
  items,
  compact = false,
  onSelectStudent,
  showFilters = false,
}: {
  items: AssignmentHistorySummary[];
  compact?: boolean;
  onSelectStudent?: (studentId: string) => void;
  showFilters?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<HistoryStatusFilter>("all");

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return items
      .filter((item) => {
        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "retried"
            ? statusPresentation(item).outcome === "retried"
            : learningActivitySection(item) === statusFilter);
        const matchesQuery =
          normalizedQuery.length === 0 ||
          [
            item.studentName,
            item.schoolName,
            item.gradeLabel,
            item.assignmentTitle,
            item.datasetTitle,
            ...item.unitLabels,
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("ko-KR")
            .includes(normalizedQuery);
        return matchesStatus && matchesQuery;
      })
      .toSorted(compareLearningActivities);
  }, [items, query, statusFilter]);

  return (
    <>
      {showFilters ? (
        <div className="history-filters">
          <label className="field">
            <span className="field-label">
              {adminHistoryText.filters.searchLabel}
            </span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder={adminHistoryText.filters.searchPlaceholder}
              type="search"
              value={query}
            />
          </label>
          <label className="field">
            <span className="field-label">
              {adminHistoryText.filters.statusLabel}
            </span>
            <SelectField
              onChange={(event) =>
                setStatusFilter(event.target.value as HistoryStatusFilter)
              }
              value={statusFilter}
            >
              <option value="all">
                {adminHistoryText.filters.statusOptions.all}
              </option>
              <option value="open">
                {adminHistoryText.filters.statusOptions.open}
              </option>
              <option value="needs_attention">
                {adminHistoryText.filters.statusOptions.needsAttention}
              </option>
              <option value="completed">
                {adminHistoryText.filters.statusOptions.completed}
              </option>
              <option value="retried">
                {adminHistoryText.filters.statusOptions.retried}
              </option>
              <option value="archived">
                {adminHistoryText.filters.statusOptions.archived}
              </option>
            </SelectField>
          </label>
        </div>
      ) : null}

      {filteredItems.length === 0 ? (
        <div className="empty-state">
          {items.length === 0
            ? adminHistoryText.emptyState.noAssignments
            : adminHistoryText.emptyState.noMatches}
        </div>
      ) : (
        <ol className="admin-history-list">
          {filteredItems.map((item) => {
            const content = <HistoryRowContent compact={compact} item={item} />;
            const outcome = statusPresentation(item).outcome;

            return (
              <li key={item.id}>
                {onSelectStudent && !item.studentDeleted ? (
                  <button
                    className={`admin-history-row openable-list-row activity-outcome-${outcome}${compact ? " is-compact" : ""}`}
                    onClick={() => onSelectStudent(item.studentId)}
                    type="button"
                  >
                    {content}
                  </button>
                ) : (
                  <OpenableListRow
                    ariaLabel={`${item.studentName} ${assignmentDisplayTitle(item)}`}
                    className={`admin-history-row activity-outcome-${outcome}${compact ? " is-compact" : ""}`}
                    href={historyDetailHref(item)}
                  >
                    {content}
                  </OpenableListRow>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
