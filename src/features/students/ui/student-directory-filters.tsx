"use client";

import { formatContentText } from "@/content/format";
import { adminStudentsText } from "@/content/ko/admin-students";
import { commonText } from "@/content/ko/common";
import {
  CountBadge,
  MetaTag,
  MetaTagList,
} from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import { Input } from "@/design-system/primitives/form/field";

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
    <div className={styles.searchPanel}>
      <label className={styles.searchField}>
        <span aria-hidden="true" className={styles.searchIcon}>
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6" />
            <path d="m16 16 4 4" />
          </svg>
        </span>
        <span className="sr-only">{adminStudentsText.page.searchAriaLabel}</span>
        <Input
          leadingAdornment
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={adminStudentsText.page.searchPlaceholder}
          type="search"
          value={filters.query}
        />
      </label>
      <details className={styles.filterDisclosure}>
        <summary>
          <span>{adminStudentsText.page.filterButton}</span>
          <CountBadge>{filterCount}</CountBadge>
        </summary>
        <div className={styles.filterGroups}>
          <fieldset>
            <legend>{adminStudentsText.page.statusFilter}</legend>
            <div className={styles.filterChips}>
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
            </div>
          </fieldset>
          <fieldset>
            <legend>{commonText.filters.wrongAvailability}</legend>
            <div className={styles.filterChips}>
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
            </div>
          </fieldset>
          {([
            ["school", commonText.filters.bySchool, options.schools],
            ["grade", commonText.filters.byGrade, options.grades],
            ["wordbook", commonText.filters.byWordbook, options.wordbooks],
          ] as const).map(([field, label, values]) => (
            <fieldset key={field}>
              <legend>{label}</legend>
              <div className={styles.filterChips}>
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
              </div>
            </fieldset>
          ))}
          {options.classGroups.length > 0 ? (
            <fieldset>
              <legend>{adminStudentsText.page.classGroupFilter}</legend>
              <div className={styles.filterChips}>
                {options.classGroups.map((group) => (
                  <Button
                    aria-pressed={filters.classGroupId === group.id}
                    key={group.id}
                    onClick={() => onChange({
                      ...filters,
                      classGroupId:
                        filters.classGroupId === group.id ? "" : group.id,
                    })}
                    size="small"
                    variant="filter"
                  >
                    {group.name}
                  </Button>
                ))}
              </div>
            </fieldset>
          ) : null}
        </div>
      </details>
      <div className={styles.filterSummary}>
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
        <div className={styles.filterSummaryActions}>
          <span aria-live="polite" className={styles.filteringStatus}>
            {filtering ? adminStudentsText.page.filtering : ""}
          </span>
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
        </div>
      </div>
    </div>
  );
}
