"use client";

import { useMemo, useState, type FormEvent } from "react";

import { studentLearningActivityIndex } from "@/features/history/domain/learning-activity";
import { HelpTip, inlineHelpClassName } from "@/design-system/primitives/tooltip/help-tip";
import {
  MetaTag,
  MetaTagList,
  CountBadge,
  StatusBadge,
} from "@/design-system/primitives/badge/badge";
import {
  EmptyState,
  Notice,
} from "@/design-system/patterns/feedback/feedback";
import {
  Button,
  buttonRecipe,
} from "@/design-system/primitives/button/button";
import {
  Field,
  FieldHelp,
  FieldLabel,
  FieldLabelRow,
  FieldRequirement,
  Input,
  Select,
  Textarea,
} from "@/design-system/primitives/form/field";
import { adminStudentsText } from "@/content/ko/admin-students";
import { commonText } from "@/content/ko/common";
import { formatContentText } from "@/content/format";
import {
  cataloguedDatasetDisplayLabel,
  groupCataloguedDatasets,
} from "@/lib/admin/dataset-catalog";
import { formatKoreanDateTime } from "@/lib/format";
import {
  indexStudentCurrentVocabWrongSummaries,
} from "@/lib/admin/wrong-history-summary";

import type { StudentDetailController } from "../controller/use-student-detail-controller";
import {
  filterAndSortStudents,
  indexStudentLearningSources,
  studentDirectoryFilterOptions,
} from "../domain/student-directory";
import { summarizeStudentDirectoryActivities } from "../domain/student-directory-summary";
import type {
  StudentDirectoryFilters,
  StudentManagementData,
} from "../model";
import styles from "./student-directory.module.css";

const initialFilters: StudentDirectoryFilters = {
  grade: "",
  query: "",
  school: "",
  wordbook: "",
  wrong: "all",
};

function StudentCreateForm({
  controller,
  data,
}: {
  controller: StudentDetailController;
  data: StudentManagementData;
}) {
  const datasetGroups = useMemo(
    () => groupCataloguedDatasets(data.datasets),
    [data.datasets],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void controller.actions.createFromForm(event.currentTarget);
  }

  return (
    <details className={styles.createDisclosure}>
      <summary className={buttonRecipe({ variant: "primary" })}>
        {adminStudentsText.createStudent.open}
      </summary>
      <div className={styles.createContent}>
        <form
          aria-busy={controller.busyKey === "create"}
          className={styles.formStack}
          onSubmit={submit}
        >
          <Field>
            <FieldLabelRow>
              <FieldLabel as="span" className={inlineHelpClassName}>
                <HelpTip
                  label={adminStudentsText.createStudent.nameHelpAria}
                  trigger={adminStudentsText.createStudent.nameLabel}
                >
                  {adminStudentsText.createStudent.nameHelp}
                </HelpTip>
              </FieldLabel>
              <FieldRequirement data-kind="required">
                {adminStudentsText.createStudent.required}
              </FieldRequirement>
            </FieldLabelRow>
            <Input
              aria-label={adminStudentsText.createStudent.nameLabel}
              id="create-student-display-name"
              maxLength={80}
              name="displayName"
              placeholder={adminStudentsText.createStudent.namePlaceholder}
              required
            />
          </Field>
          <div className={styles.formGrid}>
            <Field as="label">
              <FieldLabelRow>
                <FieldLabel as="span">
                  {adminStudentsText.createStudent.schoolLabel}
                </FieldLabel>
                <FieldRequirement>
                  {adminStudentsText.createStudent.optional}
                </FieldRequirement>
              </FieldLabelRow>
              <Input
                maxLength={120}
                name="schoolName"
                placeholder={adminStudentsText.createStudent.schoolPlaceholder}
              />
            </Field>
            <Field as="label">
              <FieldLabelRow>
                <FieldLabel as="span">
                  {adminStudentsText.createStudent.gradeLabel}
                </FieldLabel>
                <FieldRequirement>
                  {adminStudentsText.createStudent.optional}
                </FieldRequirement>
              </FieldLabelRow>
              <Input
                maxLength={40}
                name="gradeLabel"
                placeholder={adminStudentsText.createStudent.gradePlaceholder}
              />
            </Field>
          </div>
          <Field>
            <FieldLabelRow>
              <FieldLabel as="span" className={inlineHelpClassName}>
                <HelpTip
                  label={adminStudentsText.createStudent.startingWordbookHelpAria}
                  trigger={adminStudentsText.createStudent.startingWordbookLabel}
                >
                  {adminStudentsText.createStudent.startingWordbookHelp}
                </HelpTip>
              </FieldLabel>
              <FieldRequirement>
                {adminStudentsText.createStudent.optional}
              </FieldRequirement>
            </FieldLabelRow>
            <Select
              aria-label={adminStudentsText.createStudent.startingWordbookLabel}
              defaultValue=""
              id="create-student-vocab-dataset"
              name="currentVocabDatasetId"
            >
              <option value="">
                {adminStudentsText.createStudent.chooseLater}
              </option>
              {datasetGroups.map((group) => (
                <optgroup key={group.group} label={group.label}>
                  {group.datasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {cataloguedDatasetDisplayLabel(dataset)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
            {data.datasets.length === 0 ? (
              <FieldHelp>
                {adminStudentsText.createStudent.noWordbookNotice}
              </FieldHelp>
            ) : null}
          </Field>
          <Field as="label">
            <FieldLabelRow>
              <FieldLabel as="span">
                {adminStudentsText.createStudent.memoLabel}
              </FieldLabel>
              <FieldRequirement>
                {adminStudentsText.createStudent.optional}
              </FieldRequirement>
            </FieldLabelRow>
            <Textarea
              maxLength={2000}
              name="note"
              placeholder={adminStudentsText.createStudent.memoPlaceholder}
            />
          </Field>
          {controller.createError ? (
            <Notice role="alert" tone="danger">
              {controller.createError}
            </Notice>
          ) : null}
          <Button
            disabled={controller.interactionBusy}
            type="submit"
            variant="primary"
          >
            {controller.busyKey === "create"
              ? adminStudentsText.createStudent.submitting
              : adminStudentsText.createStudent.submit}
          </Button>
        </form>
      </div>
    </details>
  );
}

function StudentDirectoryFilters({
  filters,
  onChange,
  options,
  resultCount,
}: {
  filters: StudentDirectoryFilters;
  onChange: (next: StudentDirectoryFilters) => void;
  options: ReturnType<typeof studentDirectoryFilterOptions>;
  resultCount: number;
}) {
  const filterCount =
    [filters.school, filters.grade, filters.wordbook].filter(Boolean).length +
    (filters.wrong === "all" ? 0 : 1);
  const searchDisabled = filters.query.trim().length === 0;
  const wrongLabel =
    filters.wrong === "wrong"
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
        <span className="sr-only">
          {adminStudentsText.page.searchAriaLabel}
        </span>
        <Input
          leadingAdornment
          onChange={(event) =>
            onChange({ ...filters, query: event.target.value })
          }
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
            <legend>{commonText.filters.wrongAvailability}</legend>
            <div className={styles.filterChips}>
              {(
                [
                  ["all", commonText.filters.all],
                  ["wrong", commonText.filters.hasWrong],
                  ["repeated", commonText.filters.repeatedWrong],
                  ["retry", commonText.filters.retryNeeded],
                ] as const
              ).map(([value, label]) => (
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
          {(
            [
              ["school", commonText.filters.bySchool, options.schools],
              ["grade", commonText.filters.byGrade, options.grades],
              ["wordbook", commonText.filters.byWordbook, options.wordbooks],
            ] as const
          ).map(([field, label, values]) => (
            <fieldset key={field}>
              <legend>{label}</legend>
              <div className={styles.filterChips}>
                {values.map((value) => (
                  <Button
                    aria-pressed={filters[field] === value}
                    key={value}
                    onClick={() =>
                      onChange({
                        ...filters,
                        [field]: filters[field] === value ? "" : value,
                      })
                    }
                    size="small"
                    variant="filter"
                  >
                    {value}
                  </Button>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </details>
      <div className={styles.filterSummary}>
        <MetaTagList>
          {filters.school ? <MetaTag>{filters.school}</MetaTag> : null}
          {filters.grade ? <MetaTag>{filters.grade}</MetaTag> : null}
          {filters.wordbook ? <MetaTag>{filters.wordbook}</MetaTag> : null}
          {filters.wrong !== "all" ? (
            <MetaTag tone="warning">{wrongLabel}</MetaTag>
          ) : null}
        </MetaTagList>
        <div className={styles.filterSummaryActions}>
          <strong>
            {formatContentText(commonText.filters.studentCount, {
              count: resultCount,
            })}
          </strong>
          <Button
            disabled={searchDisabled}
            onClick={() => onChange({ ...filters, query: "" })}
            size="small"
            variant="quiet"
          >
            {commonText.filters.clearSearch}
          </Button>
          <Button
            disabled={filterCount === 0}
            onClick={() => onChange({ ...initialFilters, query: filters.query })}
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

export function StudentDirectory({
  controller,
  data,
}: {
  controller: StudentDetailController;
  data: StudentManagementData;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const activitiesByStudent = useMemo(
    () => studentLearningActivityIndex(data.currentHistory),
    [data.currentHistory],
  );
  const currentWrongIndex = useMemo(
    () =>
      indexStudentCurrentVocabWrongSummaries(
        data.currentVocabWrongSummaries,
      ),
    [data.currentVocabWrongSummaries],
  );
  const learningSourcesByStudent = useMemo(
    () => indexStudentLearningSources(data.learningSources),
    [data.learningSources],
  );
  const filterOptions = useMemo(
    () => studentDirectoryFilterOptions(data.students, data.learningSources),
    [data.learningSources, data.students],
  );
  const students = useMemo(
    () =>
      filterAndSortStudents({
        activitiesByStudent,
        currentWrongIndex,
        filters,
        learningSourcesByStudent,
        students: data.students,
      }),
    [
      activitiesByStudent,
      currentWrongIndex,
      filters,
      learningSourcesByStudent,
      data.students,
    ],
  );
  return (
    <>
      <StudentCreateForm controller={controller} data={data} />
      <StudentDirectoryFilters
        filters={filters}
        onChange={setFilters}
        options={filterOptions}
        resultCount={students.length}
      />
      <section className={styles.groupPane}>
        {students.length === 0 ? (
          <EmptyState>{adminStudentsText.page.noMatches}</EmptyState>
        ) : (
          <div className={styles.cardGrid}>
            {students.map((student) => {
              const activities = activitiesByStudent.get(student.id) ?? [];
              const summary = summarizeStudentDirectoryActivities(activities);
              const primary =
                student.currentVocabBook ?? adminStudentsText.card.wordbookMissing;
              return (
                <button
                  className={styles.card}
                  key={student.id}
                  onClick={() => controller.actions.openStudent(student)}
                  type="button"
                >
                  <span className={styles.cardHeading}>
                    <span className={styles.cardTitleRow}>
                      <strong className={styles.cardName}>
                        {student.displayName}
                      </strong>
                      <span className={styles.accountStatuses}>
                        <StatusBadge
                          tone={student.status === "active" ? "success" : "danger"}
                        >
                          {student.status === "active"
                            ? adminStudentsText.card.active
                            : adminStudentsText.card.blocked}
                        </StatusBadge>
                        {student.codeStatus === "expired" ? (
                          <StatusBadge tone="danger">
                            {adminStudentsText.card.codeExpired}
                          </StatusBadge>
                        ) : null}
                      </span>
                    </span>
                    <MetaTagList>
                      <MetaTag>
                        {student.schoolName ?? adminStudentsText.card.schoolMissing}
                      </MetaTag>
                      <MetaTag>
                        {student.gradeLabel ?? adminStudentsText.card.gradeMissing}
                      </MetaTag>
                    </MetaTagList>
                  </span>
                  <span className={styles.cardDetails}>
                    <span className={styles.infoRow}>
                      <small>{adminStudentsText.card.currentWordbook}</small>
                      <strong className={styles.primarySource} title={primary}>
                        {primary}
                      </strong>
                    </span>
                    <span className={styles.infoRow}>
                      <small>{adminStudentsText.card.recentExam}</small>
                      <strong className={styles.primarySource}>
                        {summary.recentAttemptAt
                          ? formatKoreanDateTime(summary.recentAttemptAt)
                          : adminStudentsText.card.noHistory}
                      </strong>
                    </span>
                    <span className={styles.activityStats}>
                      <span>
                        {adminStudentsText.card.completed} {summary.completedCount}개
                      </span>
                      <span>
                        {adminStudentsText.card.missed} {summary.missedCount}개
                      </span>
                      <span>
                        {adminStudentsText.card.notStarted} {summary.notStartedCount}개
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
