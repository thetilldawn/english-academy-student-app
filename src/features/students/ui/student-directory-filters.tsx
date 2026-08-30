"use client";

import { formatContentText } from "@/content/format";
import { adminStudentsText } from "@/content/ko/admin-students";
import { commonText } from "@/content/ko/common";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import {
  FilterWorkspace,
  FilterWorkspaceGroup,
} from "@/design-system/patterns/filter-workspace/filter-workspace";

import {
  emptyStudentDirectoryFilters,
  type StudentDirectoryFilters,
  type StudentDirectoryFilterOptions,
} from "../contracts/student-directory-read-model";
import styles from "./student-directory.module.css";

export function StudentDirectoryFilters({
  filtering,
  filters,
  onChange,
  onQueryChange,
  options,
  resultCount,
}: {
  filtering: boolean;
  filters: StudentDirectoryFilters;
  onChange: (filters: StudentDirectoryFilters) => void;
  onQueryChange: (query: string) => void;
  options: StudentDirectoryFilterOptions;
  resultCount: number;
}) {
  const filterCount = [
    filters.school,
    filters.grade,
    filters.wordbook,
    filters.classGroupId,
  ].filter(Boolean).length +
    (filters.status === "all" ? 0 : 1) +
    (filters.wrong === "all" ? 0 : 1);
  const classGroup = options.classGroups.find(
    (option) => option.id === filters.classGroupId,
  );
  const wrongLabel = filters.wrong === "wrong"
    ? commonText.filters.hasWrong
    : filters.wrong === "repeated"
      ? commonText.filters.repeatedWrong
      : commonText.filters.retryNeeded;

  return (
    <FilterWorkspace
      activeFilterCount={filterCount}
      activeTags={(
        <MetaTagList>
          {filters.school ? <MetaTag>{filters.school}</MetaTag> : null}
          {filters.grade ? <MetaTag>{filters.grade}</MetaTag> : null}
          {filters.wordbook ? <MetaTag>{filters.wordbook}</MetaTag> : null}
          {classGroup ? <MetaTag>{classGroup.name}</MetaTag> : null}
          {filters.status !== "all" ? (
            <MetaTag>
              {filters.status === "active"
                ? adminStudentsText.card.active
                : adminStudentsText.card.blocked}
            </MetaTag>
          ) : null}
          {filters.wrong !== "all" ? (
            <MetaTag tone="warning">{wrongLabel}</MetaTag>
          ) : null}
        </MetaTagList>
      )}
      className={styles.directoryFilters}
      filterLabel={adminStudentsText.page.filterButton}
      filteringStatus={filtering ? adminStudentsText.page.filtering : ""}
      onQueryChange={onQueryChange}
      query={filters.query}
      searchAriaLabel={adminStudentsText.page.searchAriaLabel}
      searchPlaceholder={adminStudentsText.page.searchPlaceholder}
      summaryActions={(
        <>
          <strong>
            {formatContentText(commonText.filters.studentCount, {
              count: resultCount,
            })}
          </strong>
          <Button
            disabled={!filters.query}
            onClick={() => onQueryChange("")}
            size="small"
            variant="quiet"
          >
            {commonText.filters.clearSearch}
          </Button>
          <Button
            disabled={filterCount === 0}
            onClick={() => onChange({
              ...emptyStudentDirectoryFilters,
              query: filters.query,
            })}
            size="small"
            variant="quiet"
          >
            {adminStudentsText.page.resetFilters}
          </Button>
        </>
      )}
    >
      <FilterWorkspaceGroup label={adminStudentsText.page.statusFilter}>
        {([
          ["all", commonText.filters.all],
          ["active", adminStudentsText.card.active],
          ["blocked", adminStudentsText.card.blocked],
        ] as const).map(([value, label]) => (
          <Button
            aria-pressed={filters.status === value}
            key={value}
            onClick={() => onChange({ ...filters, status: value })}
            size="small"
            variant="filter"
          >
            {label}
          </Button>
        ))}
      </FilterWorkspaceGroup>

      <FilterWorkspaceGroup label={commonText.filters.wrongAvailability}>
        {([
          ["all", commonText.filters.all],
          ["wrong", commonText.filters.hasWrong],
          ["repeated", commonText.filters.repeatedWrong],
          ["retry", commonText.filters.retryNeeded],
        ] as const).map(([value, label]) => (
          <Button
            aria-pressed={filters.wrong === value}
            key={value}
            onClick={() => onChange({ ...filters, wrong: value })}
            size="small"
            variant="filter"
          >
            {label}
          </Button>
        ))}
      </FilterWorkspaceGroup>

      {([
        ["school", commonText.filters.bySchool, options.schools],
        ["grade", commonText.filters.byGrade, options.grades],
        ["wordbook", commonText.filters.byWordbook, options.wordbooks],
      ] as const).map(([field, label, values]) => (
        <FilterWorkspaceGroup key={field} label={label}>
          {values.map((value) => (
            <Button
              aria-pressed={filters[field] === value}
              key={value}
              onClick={() => onChange({
                ...filters,
                [field]: filters[field] === value ? "" : value,
              })}
              size="small"
              variant="filter"
            >
              {value}
            </Button>
          ))}
        </FilterWorkspaceGroup>
      ))}

      {options.classGroups.length > 0 ? (
        <FilterWorkspaceGroup label={adminStudentsText.page.classGroupFilter}>
          {options.classGroups.map((group) => (
            <Button
              aria-pressed={filters.classGroupId === group.id}
              key={group.id}
              onClick={() => onChange({
                ...filters,
                classGroupId: filters.classGroupId === group.id ? "" : group.id,
              })}
              size="small"
              variant="filter"
            >
              {group.name}
            </Button>
          ))}
        </FilterWorkspaceGroup>
      ) : null}
    </FilterWorkspace>
  );
}
