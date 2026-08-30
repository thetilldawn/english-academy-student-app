import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { commonText } from "@/content/ko/common";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import {
  FilterWorkspace,
  FilterWorkspaceGroup,
} from "@/design-system/patterns/filter-workspace/filter-workspace";
import type {
  StudentDirectoryFilters,
  StudentDirectoryWrongFilter,
} from "@/features/students/public-contracts";

const wrongFilters: ReadonlyArray<
  readonly [StudentDirectoryWrongFilter, string]
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
  classGroupOptions,
  filters,
  gradeOptions,
  onClearSearch,
  onResetFilters,
  onSetFilter,
  schoolOptions,
  totalCount,
  wordbookOptions,
}: {
  classGroupOptions: readonly { label: string; value: string }[];
  filters: StudentDirectoryFilters;
  gradeOptions: readonly string[];
  onClearSearch: () => void;
  onResetFilters: () => void;
  onSetFilter: <Key extends keyof StudentDirectoryFilters>(
    key: Key,
    value: StudentDirectoryFilters[Key],
  ) => void;
  schoolOptions: readonly string[];
  totalCount: number;
  wordbookOptions: readonly string[];
}) {
  const activeCount = [
    filters.school,
    filters.grade,
    filters.wordbook,
    filters.classGroupId,
  ].filter(Boolean).length +
    (filters.status === "active" ? 0 : 1) +
    (filters.wrong === "all" ? 0 : 1);

  return (
    <FilterWorkspace
      activeFilterCount={activeCount}
      activeTags={(
        <MetaTagList>
          {filters.school ? <MetaTag>{filters.school}</MetaTag> : null}
          {filters.grade ? <MetaTag>{filters.grade}</MetaTag> : null}
          {filters.wordbook ? <MetaTag>{filters.wordbook}</MetaTag> : null}
          {filters.classGroupId ? (
            <MetaTag>
              {classGroupOptions.find(
                (option) => option.value === filters.classGroupId,
              )?.label ?? commonText.filters.byClassGroup}
            </MetaTag>
          ) : null}
          {filters.status === "blocked" ? (
            <MetaTag tone="warning">{commonText.filters.blocked}</MetaTag>
          ) : null}
          {filters.wrong !== "all" ? (
            <MetaTag tone="warning">
              {filters.wrong === "wrong"
                ? commonText.filters.hasWrong
                : filters.wrong === "repeated"
                  ? commonText.filters.repeatedWrong
                  : commonText.filters.retryNeeded}
            </MetaTag>
          ) : null}
        </MetaTagList>
      )}
      filterLabel={adminLearningText.page.filterButton}
      onQueryChange={(query) => onSetFilter("query", query)}
      query={filters.query}
      searchAriaLabel={adminLearningText.page.searchAriaLabel}
      searchPlaceholder={adminLearningText.page.searchPlaceholder}
      summaryActions={(
        <>
          <strong>
            {formatContentText(commonText.filters.studentCount, {
              count: totalCount,
            })}
          </strong>
          <Button
            disabled={filters.query.trim().length === 0}
            onClick={onClearSearch}
            size="small"
            variant="quiet"
          >
            {commonText.filters.clearSearch}
          </Button>
          <Button
            disabled={activeCount === 0}
            onClick={onResetFilters}
            size="small"
            variant="quiet"
          >
            {adminLearningText.page.resetFilters}
          </Button>
        </>
      )}
    >
      <FilterWorkspaceGroup label={commonText.filters.byStatus}>
        <Button
          aria-pressed={filters.status === "active"}
          onClick={() => onSetFilter("status", "active")}
          size="small"
          variant="filter"
        >
          {commonText.filters.active}
        </Button>
        <Button
          aria-pressed={filters.status === "blocked"}
          onClick={() => onSetFilter("status", "blocked")}
          size="small"
          variant="filter"
        >
          {commonText.filters.blocked}
        </Button>
      </FilterWorkspaceGroup>

      <FilterWorkspaceGroup label={commonText.filters.wrongAvailability}>
        {wrongFilters.map(([value, label]) => (
          <Button
            aria-pressed={filters.wrong === value}
            key={value}
            onClick={() => onSetFilter("wrong", value)}
            size="small"
            variant="filter"
          >
            {label}
          </Button>
        ))}
      </FilterWorkspaceGroup>

      <FilterGroup
        label={commonText.filters.bySchool}
        onChange={(value) =>
          onSetFilter("school", toggleValue(filters.school, value))
        }
        options={schoolOptions}
        value={filters.school}
      />
      <IdFilterGroup
        label={commonText.filters.byClassGroup}
        onChange={(value) =>
          onSetFilter(
            "classGroupId",
            toggleValue(filters.classGroupId, value),
          )
        }
        options={classGroupOptions}
        value={filters.classGroupId}
      />
      <FilterGroup
        label={commonText.filters.byGrade}
        onChange={(value) =>
          onSetFilter("grade", toggleValue(filters.grade, value))
        }
        options={gradeOptions}
        value={filters.grade}
      />
      <FilterGroup
        label={commonText.filters.byWordbook}
        onChange={(value) =>
          onSetFilter("wordbook", toggleValue(filters.wordbook, value))
        }
        options={wordbookOptions}
        value={filters.wordbook}
      />
    </FilterWorkspace>
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
    <FilterWorkspaceGroup label={label}>
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
    </FilterWorkspaceGroup>
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
    <FilterWorkspaceGroup label={label}>
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
    </FilterWorkspaceGroup>
  );
}
