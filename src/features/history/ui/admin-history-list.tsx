"use client";

import { useMemo, useState } from "react";

import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldLabel,
  Input,
  Select,
} from "@/design-system/primitives/form/field";
import { EmptyState } from "@/design-system/patterns/feedback/feedback";
import { adminHistoryText } from "@/content/ko/admin-history";
import type { AdminHistorySnapshot } from "@/features/history/contracts/admin-history-read-model";
import { useAdminHistoryListController } from "@/features/history/controller/use-admin-history-list-controller";
import type { AdminHistoryStatusFilter } from "@/features/history/domain/learning-activity";

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

const sectionTitles: Record<string, string> = {
  open: adminHistoryText.sections.open,
  needs_attention: adminHistoryText.sections.needsAttention,
  completed: adminHistoryText.sections.completed,
  archived: adminHistoryText.sections.archived,
};

function snapshotSections(snapshot: AdminHistorySnapshot): HistorySection[] {
  if (snapshot.statusFilter !== "all") {
    const statusFilter = snapshot.statusFilter;
    return snapshot.sections.map((section) => ({
      ...section,
      defaultOpen: true,
      title: statusFilterTitles[statusFilter],
    }));
  }
  return snapshot.sections.map((section) => ({
    ...section,
    title: sectionTitles[section.groupKey] ?? section.groupKey,
  }));
}

type AdminHistoryListProps = {
  initialSnapshot: AdminHistorySnapshot;
  showFilters?: boolean;
};

function AdminHistoryListContent({
  initialSnapshot,
  query,
  setQuery,
  setStatusFilter,
  showFilters = false,
  statusFilter,
}: AdminHistoryListProps & {
  query: string;
  setQuery: (value: string) => void;
  setStatusFilter: (value: AdminHistoryStatusFilter) => void;
  statusFilter: AdminHistoryStatusFilter;
}) {
  const { error, loading, retry, snapshot } =
    useAdminHistoryListController(initialSnapshot, { query, statusFilter });

  const sections = useMemo(() => snapshotSections(snapshot), [snapshot]);
  const itemCount = sections.reduce(
    (total, section) => total + section.totalCount,
    0,
  );
  const hasActiveConditions =
    snapshot.query.length > 0 || snapshot.statusFilter !== "all";

  return (
    <>
      {showFilters ? (
        <div className={styles.filters}>
          <Field as="label">
            <FieldLabel as="span">
              {adminHistoryText.filters.searchLabel}
            </FieldLabel>
            <Input
              maxLength={80}
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

      <p
        aria-live="polite"
        className={error ? styles.requestError : styles.requestState}
        role={error ? "alert" : undefined}
      >
        {loading ? "계산 중..." : error || "\u00a0"}
      </p>
      {error ? (
        <Button onClick={retry} type="button" variant="secondary">
          다시 시도
        </Button>
      ) : null}

      {itemCount === 0 ? (
        <EmptyState>
          {hasActiveConditions
            ? adminHistoryText.emptyState.noMatches
            : adminHistoryText.emptyState.noAssignments}
        </EmptyState>
      ) : (
        <HistorySectionGroups
          countSuffix={adminHistoryText.sections.countSuffix}
          loadMoreContext={{
            currentOnly: snapshot.currentOnly,
            query: snapshot.query,
            statusFilter: snapshot.statusFilter,
          }}
          revision={snapshot.snapshotAt}
          sections={sections}
        />
      )}
    </>
  );
}

export function AdminHistoryList(props: AdminHistoryListProps) {
  const [query, setQuery] = useState(props.initialSnapshot.query);
  const [statusFilter, setStatusFilter] =
    useState<AdminHistoryStatusFilter>(props.initialSnapshot.statusFilter);

  return (
    <AdminHistoryListContent
      {...props}
      key={props.initialSnapshot.snapshotAt}
      query={query}
      setQuery={setQuery}
      setStatusFilter={setStatusFilter}
      statusFilter={statusFilter}
    />
  );
}
