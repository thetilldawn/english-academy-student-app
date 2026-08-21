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
  adminHistoryActivityGroups,
  compareAdminHistoryRecency,
  matchesAdminHistoryStatusFilter,
  type AdminHistoryStatusFilter,
} from "@/features/history/domain/learning-activity";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { EmptyState } from "@/design-system/patterns/feedback/feedback";

import {
  HistorySectionGroups,
  type HistorySection,
} from "./history-section-groups";
import styles from "./history-list.module.css";

const statusFilterTitles: Record<
  Exclude<AdminHistoryStatusFilter, "all">,
  string
> = {
  open: adminHistoryText.filters.statusOptions.open,
  needs_attention: adminHistoryText.filters.statusOptions.needsAttention,
  missed: adminHistoryText.filters.statusOptions.missed,
  completed: adminHistoryText.filters.statusOptions.completed,
  retried: adminHistoryText.filters.statusOptions.retried,
  archived: adminHistoryText.filters.statusOptions.archived,
};

export function AdminHistoryList({
  items,
  showFilters = false,
}: {
  items: AssignmentHistorySummary[];
  showFilters?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<AdminHistoryStatusFilter>("all");

  const sections = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    const filteredItems = items.filter((item) => {
      const matchesStatus = matchesAdminHistoryStatusFilter(
        item,
        statusFilter,
      );
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
    });
    const groups = adminHistoryActivityGroups(filteredItems);
    if (statusFilter !== "all") {
      return [
        {
          id: `filter-${statusFilter}`,
          title: statusFilterTitles[statusFilter],
          items: [
            ...groups.open,
            ...groups.needsAttention,
            ...groups.completed,
            ...groups.archived,
          ].toSorted(compareAdminHistoryRecency),
        },
      ].filter((section) => section.items.length > 0);
    }
    const groupedSections: HistorySection[] = [
      {
        id: "open",
        title: adminHistoryText.sections.open,
        items: groups.open,
      },
      {
        id: "needs-attention",
        title: adminHistoryText.sections.needsAttention,
        items: groups.needsAttention,
      },
      {
        id: "completed",
        title: adminHistoryText.sections.completed,
        items: groups.completed,
      },
      {
        id: "archived",
        title: adminHistoryText.sections.archived,
        items: groups.archived,
      },
    ];
    return groupedSections.filter((section) => section.items.length > 0);
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
                setStatusFilter(event.target.value as AdminHistoryStatusFilter)
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
              <option value="missed">
                {adminHistoryText.filters.statusOptions.missed}
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

      {sections.length === 0 ? (
        <EmptyState>
          {items.length === 0
            ? adminHistoryText.emptyState.noAssignments
            : adminHistoryText.emptyState.noMatches}
        </EmptyState>
      ) : (
        <HistorySectionGroups
          countSuffix={adminHistoryText.sections.countSuffix}
          sections={sections}
        />
      )}
    </>
  );
}
