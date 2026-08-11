"use client";

import { useMemo, useState } from "react";

import { CountBadge } from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import { Select } from "@/design-system/primitives/form/field";
import { formatContentText } from "@/content/format";
import { adminStudentsText } from "@/content/ko/admin-students";
import {
  learningActivitySection,
  matchesLearningHistoryFilters,
  sortLearningActivities,
  type LearningActivitySection,
  type LearningHistoryPurposeFilter,
  type LearningHistoryStatusFilter,
} from "@/features/history/domain/learning-activity";
import type { AssignmentHistorySummary } from "@/lib/admin/history";

import { HistoryActivityRow } from "./history-activity-row";
import styles from "./student-learning-activity-list.module.css";

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
];

export function StudentLearningActivityList({
  emptyLabel = adminStudentsText.learning.activityList.empty,
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
          (filtersEnabled || learningActivitySection(item) !== "archived") &&
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
  const availableSections = filtersEnabled
    ? [
        ...sectionDefinitions,
        {
          id: "archived" as const,
          label: adminStudentsText.learning.activitySections.archived,
        },
      ]
    : sectionDefinitions;
  const visibleSections = availableSections
    .map((section) => ({
      ...section,
      items: visible.filter(
        (item) => learningActivitySection(item) === section.id,
      ),
    }))
    .filter((section) => section.items.length > 0);

  if (!filtersEnabled && sorted.length === 0) {
    return <div className={`empty-state ${styles.empty}`}>{emptyLabel}</div>;
  }

  return (
    <div className={styles.region}>
      {filtersEnabled ? (
        <div
          aria-label={adminStudentsText.learning.activityList.filterAria}
          className={styles.filters}
        >
          <label>
            <span>{adminStudentsText.learning.activityList.filters.type}</span>
            <Select
              onChange={(event) => {
                setPurposeFilter(
                  event.target.value as LearningHistoryPurposeFilter,
                );
                setExpanded(false);
              }}
              value={purposeFilter}
            >
              <option value="all">
                {adminStudentsText.learning.activityList.filters.allTypes}
              </option>
              <option value="regular">
                {adminStudentsText.learning.activityList.filters.regular}
              </option>
              <option value="mixed">
                {adminStudentsText.learning.activityList.filters.mixed}
              </option>
              <option value="review">
                {adminStudentsText.learning.activityList.filters.review}
              </option>
            </Select>
          </label>
          <label>
            <span>{adminStudentsText.learning.activityList.filters.status}</span>
            <Select
              onChange={(event) => {
                setStatusFilter(
                  event.target.value as LearningHistoryStatusFilter,
                );
                setExpanded(false);
              }}
              value={statusFilter}
            >
              <option value="all">
                {adminStudentsText.learning.activityList.filters.allStatuses}
              </option>
              <option value="open">
                {adminStudentsText.learning.activityList.filters.open}
              </option>
              <option value="needs_attention">
                {adminStudentsText.learning.activityList.filters.needsAttention}
              </option>
              <option value="completed">
                {adminStudentsText.learning.activityList.filters.completed}
              </option>
              <option value="archived">
                {adminStudentsText.learning.activityList.filters.archived}
              </option>
            </Select>
          </label>
          <label>
            <span>{adminStudentsText.learning.activityList.filters.period}</span>
            <Select
              onChange={(event) => {
                setPeriodFilter(
                  event.target.value as "all" | "30" | "90" | "365",
                );
                setExpanded(false);
              }}
              value={periodFilter}
            >
              <option value="all">
                {adminStudentsText.learning.activityList.filters.allPeriods}
              </option>
              <option value="30">
                {adminStudentsText.learning.activityList.filters.recent30}
              </option>
              <option value="90">
                {adminStudentsText.learning.activityList.filters.recent90}
              </option>
              <option value="365">
                {adminStudentsText.learning.activityList.filters.recentYear}
              </option>
            </Select>
          </label>
        </div>
      ) : null}

      {sorted.length === 0 ? (
        <div className={`empty-state ${styles.empty}`}>
          {filtersEnabled
            ? adminStudentsText.learning.activityList.noMatches
            : emptyLabel}
        </div>
      ) : (
        <div className={styles.sections}>
          {visibleSections.map((section) => (
            <section
              aria-labelledby={`learning-activity-${section.id}`}
              className={styles.section}
              key={section.id}
            >
              <div className={styles.sectionHeading}>
                <h4 id={`learning-activity-${section.id}`}>
                  {section.label}
                </h4>
                <CountBadge>
                  {formatContentText(
                    adminStudentsText.learning.activityList.count,
                    { count: section.items.length },
                  )}
                </CountBadge>
              </div>
              <ol className={styles.list}>
                {section.items.map((item) => (
                  <li key={item.id}>
                    <HistoryActivityRow
                      compact
                      item={item}
                      showStudent={false}
                    />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {sorted.length > initialLimit ? (
        <Button
          aria-expanded={expanded}
          className={styles.expand}
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
      ) : null}
    </div>
  );
}
