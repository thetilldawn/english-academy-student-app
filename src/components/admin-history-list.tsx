"use client";

import { useMemo, useState } from "react";

import { ActivityStatusTimeline } from "@/components/activity-status-timeline";
import { AssignmentMetaTags } from "@/components/assignment-meta-tags";
import { AttemptScoreSummary } from "@/components/attempt-score-summary";
import {
  ActivityRowContent,
  OpenableListRow,
} from "@/components/ui-list-row";
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
import {
  Field,
  FieldLabel,
  Input,
  Select,
} from "@/design-system/primitives/form/field";

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
  const displayTitle = assignmentDisplayTitle(item);
  return (
    <ActivityRowContent
      main={
        <>
          <span className="activity-row-title-line">
            <strong>{item.studentName}</strong>
            {displayTitle ? (
              <span className="activity-row-title">{displayTitle}</span>
            ) : null}
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
  showFilters = false,
}: {
  items: AssignmentHistorySummary[];
  compact?: boolean;
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
          <Field as="label" >
            <FieldLabel as="span" >
              {adminHistoryText.filters.searchLabel}
            </FieldLabel>
            <Input
              onChange={(event) => setQuery(event.target.value)}
              placeholder={adminHistoryText.filters.searchPlaceholder}
              type="search"
              value={query}
            />
          </Field>
          <Field as="label" >
            <FieldLabel as="span" >
              {adminHistoryText.filters.statusLabel}
            </FieldLabel>
            <Select
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
            </Select>
          </Field>
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
            const outcome = statusPresentation(item).outcome;

            return (
              <li key={item.id}>
                <OpenableListRow
                  ariaLabel={`${item.studentName} ${assignmentDisplayTitle(item) || item.datasetTitle}`}
                  className={`admin-history-row activity-outcome-${outcome}${compact ? " is-compact" : ""}`}
                  href={historyDetailHref(item)}
                >
                  <HistoryRowContent compact={compact} item={item} />
                </OpenableListRow>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
