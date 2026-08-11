"use client";

import { useMemo, useState } from "react";

import {
  Field,
  FieldLabel,
  Input,
  Select,
} from "@/design-system/primitives/form/field";
import { adminHistoryText } from "@/content/ko/admin-history";
import {
  compareLearningActivities,
  learningActivitySection,
} from "@/features/history/domain/learning-activity";
import { buildAttemptStatusPresentation } from "@/features/history/presentation/attempt-presentation";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { EmptyState } from "@/design-system/patterns/feedback/feedback";

import { HistoryRows } from "./history-rows";
import styles from "./history-list.module.css";

type HistoryStatusFilter =
  | "all"
  | "open"
  | "needs_attention"
  | "completed"
  | "retried"
  | "archived";

export function AdminHistoryList({
  items,
  showFilters = false,
}: {
  items: AssignmentHistorySummary[];
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
            ? buildAttemptStatusPresentation(item).outcome === "retried"
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
        <div className={styles.filters}>
          <Field as="label">
            <FieldLabel as="span">
              {adminHistoryText.filters.searchLabel}
            </FieldLabel>
            <Input
              onChange={(event) => setQuery(event.target.value)}
              placeholder={adminHistoryText.filters.searchPlaceholder}
              type="search"
              value={query}
            />
          </Field>
          <Field as="label">
            <FieldLabel as="span">
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
        <EmptyState>
          {items.length === 0
            ? adminHistoryText.emptyState.noAssignments
            : adminHistoryText.emptyState.noMatches}
        </EmptyState>
      ) : (
        <HistoryRows items={filteredItems} />
      )}
    </>
  );
}
