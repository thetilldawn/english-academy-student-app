import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { commonText } from "@/content/ko/common";
import {
  CountBadge,
  MetaTag,
  MetaTagList,
} from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import { Input } from "@/design-system/primitives/form/field";

import type {
  AssignmentWorkspaceController,
  WrongWordStudentFilter,
} from "../controller/use-assignment-workspace";
import styles from "./assignment-workspace.module.css";

const wrongFilters: ReadonlyArray<
  readonly [WrongWordStudentFilter, string]
> = [
  ["all", commonText.filters.all],
  ["wrong", commonText.filters.hasWrong],
  ["repeated", commonText.filters.repeatedWrong],
  ["retry", commonText.filters.retryNeeded],
];

function toggleValue(current: string, next: string) {
  return current === next ? "" : next;
}

export function AssignmentWorkspaceFilters({
  controller,
}: {
  controller: AssignmentWorkspaceController;
}) {
  const { actions, filters } = controller;
  const activeCount =
    [filters.school, filters.grade, filters.wordbook, filters.classGroup].filter(Boolean).length +
    (filters.status === "active" ? 0 : 1) +
    (filters.wrongWord === "all" ? 0 : 1);
  const resetDisabled = activeCount === 0;

  return (
    <div className={styles.searchPanel}>
      <label className={styles.searchField}>
        <span aria-hidden="true" className={styles.searchIcon}>
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6" />
            <path d="m16 16 4 4" />
          </svg>
        </span>
        <span className="sr-only">
          {adminLearningText.page.searchAriaLabel}
        </span>
        <Input
          leadingAdornment
          onChange={(event) => actions.setFilter("query", event.target.value)}
          placeholder={adminLearningText.page.searchPlaceholder}
          type="search"
          value={filters.query}
        />
      </label>

      <details className={styles.filterDisclosure}>
        <summary>
          <span>{adminLearningText.page.filterButton}</span>
          <CountBadge>{activeCount}</CountBadge>
        </summary>
        <div className={styles.filterGroups}>
          <fieldset>
            <legend>{commonText.filters.byStatus}</legend>
            <div className={styles.filterChips}>
              <Button
                aria-pressed={filters.status === "active"}
                onClick={() => actions.setFilter("status", "active")}
                size="small"
                variant="filter"
              >
                {commonText.filters.active}
              </Button>
              <Button
                aria-pressed={filters.status === "blocked"}
                onClick={() => actions.setFilter("status", "blocked")}
                size="small"
                variant="filter"
              >
                {commonText.filters.blocked}
              </Button>
            </div>
          </fieldset>
          <fieldset>
            <legend>{commonText.filters.wrongAvailability}</legend>
            <div className={styles.filterChips}>
              {wrongFilters.map(([value, label]) => (
                <Button
                  aria-pressed={filters.wrongWord === value}
                  key={value}
                  onClick={() => actions.setFilter("wrongWord", value)}
                  size="small"
                  variant="filter"
                >
                  {label}
                </Button>
              ))}
            </div>
          </fieldset>
          <FilterGroup
            label={commonText.filters.bySchool}
            onChange={(value) =>
              actions.setFilter("school", toggleValue(filters.school, value))
            }
            options={controller.schoolOptions}
            value={filters.school}
          />
          <IdFilterGroup
            label={commonText.filters.byClassGroup}
            onChange={(value) =>
              actions.setFilter(
                "classGroup",
                toggleValue(filters.classGroup, value),
              )
            }
            options={controller.classGroupOptions}
            value={filters.classGroup}
          />
          <FilterGroup
            label={commonText.filters.byGrade}
            onChange={(value) =>
              actions.setFilter("grade", toggleValue(filters.grade, value))
            }
            options={controller.gradeOptions}
            value={filters.grade}
          />
          <FilterGroup
            label={commonText.filters.byWordbook}
            onChange={(value) =>
              actions.setFilter(
                "wordbook",
                toggleValue(filters.wordbook, value),
              )
            }
            options={controller.wordbookOptions}
            value={filters.wordbook}
          />
        </div>
      </details>

      <div className={styles.filterSummary}>
        <MetaTagList>
          {filters.school ? <MetaTag>{filters.school}</MetaTag> : null}
          {filters.grade ? <MetaTag>{filters.grade}</MetaTag> : null}
          {filters.wordbook ? <MetaTag>{filters.wordbook}</MetaTag> : null}
          {filters.classGroup ? (
            <MetaTag>
              {controller.classGroupOptions.find(
                (option) => option.value === filters.classGroup,
              )?.label ?? commonText.filters.byClassGroup}
            </MetaTag>
          ) : null}
          {filters.status === "blocked" ? (
            <MetaTag tone="warning">{commonText.filters.blocked}</MetaTag>
          ) : null}
          {filters.wrongWord !== "all" ? (
            <MetaTag tone="warning">
              {filters.wrongWord === "wrong"
                ? commonText.filters.hasWrong
                : filters.wrongWord === "repeated"
                  ? commonText.filters.repeatedWrong
                  : commonText.filters.retryNeeded}
            </MetaTag>
          ) : null}
        </MetaTagList>
        <div className={styles.filterSummaryActions}>
          <strong>
            {formatContentText(commonText.filters.studentCount, {
              count: controller.filteredStudents.length,
            })}
          </strong>
          <Button
            disabled={resetDisabled}
            onClick={actions.resetFilters}
            size="small"
            variant="quiet"
          >
            {adminLearningText.page.resetFilters}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FilterGroup({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: readonly string[];
  value: string;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className={styles.filterChips}>
        {options.map((option) => (
          <Button
            aria-pressed={value === option}
            key={option}
            onClick={() => onChange(option)}
            size="small"
            variant="filter"
          >
            {option}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

function IdFilterGroup({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: readonly { label: string; value: string }[];
  value: string;
}) {
  if (options.length === 0) return null;
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className={styles.filterChips}>
        {options.map((option) => (
          <Button
            aria-pressed={value === option.value}
            key={option.value}
            onClick={() => onChange(option.value)}
            size="small"
            variant="filter"
          >
            {option.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
