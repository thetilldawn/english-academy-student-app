"use client";

import {
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  HelpTip,
} from "@/design-system/primitives/tooltip/help-tip";
import { BulkAssignmentDialog } from "@/components/bulk-assignment-dialog";
import { ActivityStatusTimeline } from "@/components/activity-status-timeline";
import { AttemptScoreSummary } from "@/components/attempt-score-summary";
import { AssignmentMetaTags } from "@/components/assignment-meta-tags";
import {
  MetaTag,
  MetaTagList,
} from "@/design-system/primitives/badge/badge";
import { StudentLearningActivityList } from "@/components/student-learning-activity-list";
import {
  ActivityRowContent,
  SelectableListRow,
} from "@/components/ui-list-row";
import {
  assignmentDisplayTitle,
  projectCurrentAssignmentHistory,
  type AssignmentHistorySummary,
} from "@/lib/admin/history";
import { historyDetailHref } from "@/lib/admin/history-route";
import type { AssignmentReplacementResult } from "@/lib/admin/assignment-edit";
import {
  activityNeedsRetry,
  compareLearningActivities,
  studentLearningActivityIndex,
} from "@/lib/admin/learning-activity";
import {
  availableReviewCount,
  emptyPendingReviewCounts,
  indexStudentPendingReviewSummaries,
  pendingReviewCount,
  pendingReviewSummaryKey,
  type StudentPendingReviewSummary,
} from "@/lib/admin/review-queue-summary";
import {
  currentVocabWrongSummaryKey,
  emptyCurrentVocabWrongCounts,
  indexStudentCurrentVocabWrongSummaries,
  type StudentCurrentVocabWrongSummary,
} from "@/lib/admin/wrong-history-summary";
import { newAssignmentDefaultUnitId } from "@/lib/admin/new-assignment-range";
import { learningSourceTypeLabel } from "@/lib/admin/learning-sources";
import { adminLearningText } from "@/content/ko/admin-learning";
import { commonText } from "@/content/ko/common";
import { formatContentText } from "@/content/format";
import { Tabs } from "@/design-system/primitives/tabs/tabs";
import {
  DialogBody,
  DialogFrame,
  DialogHeader,
} from "@/design-system/primitives/dialog/dialog";
import {
  Button,
  ButtonLink,
  IconButton,
} from "@/design-system/primitives/button/button";
import { Input } from "@/design-system/primitives/form/field";
import {
  type AssignmentDatasetItem,
  type AssignmentLearningSourceItem,
  type AssignmentProgressItem,
  type AssignmentStudentItem,
  type AssignmentUnitItem,
} from "@/features/assignments/catalog-types";
import {
  SingleAssignmentEditor,
} from "@/features/assignments/ui/single-assignment-editor";
import type { SingleAssignmentResult } from "@/features/assignments/controller/use-assignment-controller";

import styles from "./assignment-manager.module.css";

export type {
  AssignmentDatasetItem,
  AssignmentUnitItem,
} from "@/features/assignments/catalog-types";

function AssignmentDialogContainer({
  children,
  closeDisabled,
  embedded,
  onRequestClose,
}: {
  children: ReactNode;
  closeDisabled: boolean;
  embedded: boolean;
  onRequestClose: () => void;
}) {
  if (embedded) {
    return <>{children}</>;
  }

  return (
    <DialogFrame
      aria-labelledby="assignment-dialog-title"
      closeDisabled={closeDisabled}
      fullScreenMobile
      height="large"
      layout="body-footer"
      onRequestClose={onRequestClose}
      size="extra-wide"
    >
      {children}
    </DialogFrame>
  );
}

function AssignmentDialogBody({
  children,
  embedded,
}: {
  children: ReactNode;
  embedded: boolean;
}) {
  return (
    <DialogBody
      className={[
        "learning-dialog-body",
        embedded ? "assignment-embedded-body" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </DialogBody>
  );
}

type WrongWordStudentFilter = "all" | "wrong" | "repeated" | "retry";

function recommendationLabel(progress: AssignmentProgressItem | null) {
  if (!progress) return adminLearningText.recommendation.needsWordbook;
  if (progress.recommendationReason === "complete") {
    return adminLearningText.recommendation.complete;
  }
  if (progress.recommendationReason === "assigned") {
    return formatContentText(adminLearningText.recommendation.labels.missed, {
      range:
        progress.recommendedUnitLabel ??
        adminLearningText.recommendation.assignedFallback,
    });
  }
  if (progress.recommendationReason === "resume") {
    return formatContentText(adminLearningText.recommendation.labels.resume, {
      range:
        progress.recommendedUnitLabel ??
        adminLearningText.recommendation.recentFallback,
    });
  }
  if (progress.recommendationReason === "repeat") {
    return formatContentText(adminLearningText.recommendation.labels.repeat, {
      range:
        progress.recommendedUnitLabel ??
        adminLearningText.recommendation.recentFallback,
    });
  }
  if (progress.recommendationReason === "manual") {
    return adminLearningText.recommendation.manual;
  }
  return (
    progress.recommendedUnitLabel ??
    adminLearningText.recommendation.firstFallback
  );
}

function recommendationReasonLabel(progress: AssignmentProgressItem | null) {
  if (!progress) {
    return adminLearningText.recommendation.reasons.needsWordbook;
  }
  if (progress.recommendationReason === "assigned") {
    return adminLearningText.recommendation.reasons.assigned;
  }
  if (progress.recommendationReason === "resume") {
    return adminLearningText.recommendation.reasons.resume;
  }
  if (progress.recommendationReason === "repeat") {
    return adminLearningText.recommendation.reasons.repeat;
  }
  if (progress.recommendationReason === "next") {
    return adminLearningText.recommendation.reasons.next;
  }
  if (progress.recommendationReason === "first") {
    return adminLearningText.recommendation.reasons.first;
  }
  if (progress.recommendationReason === "complete") {
    return adminLearningText.recommendation.reasons.complete;
  }
  return adminLearningText.recommendation.reasons.manual;
}

export function AssignmentManager({
  datasets,
  students,
  units,
  progress,
  pendingReviewSummaries,
  currentVocabWrongSummaries,
  learningSources = [],
  history,
  initialDatasetId = "",
  initialEditTarget = null,
  initialStudentId = "",
  initialDialogView = "overview",
  launcherOnly = false,
  embedded = false,
  onAssignmentReplaced,
  onLauncherClose,
}: {
  datasets: AssignmentDatasetItem[];
  students: AssignmentStudentItem[];
  units: AssignmentUnitItem[];
  progress: AssignmentProgressItem[];
  pendingReviewSummaries: StudentPendingReviewSummary[];
  currentVocabWrongSummaries: StudentCurrentVocabWrongSummary[];
  learningSources?: AssignmentLearningSourceItem[];
  history: AssignmentHistorySummary[];
  initialDatasetId?: string;
  initialEditTarget?: {
    assignmentId: string;
    studentId: string;
  } | null;
  initialStudentId?: string;
  initialDialogView?: "overview" | "assign";
  launcherOnly?: boolean;
  embedded?: boolean;
  onAssignmentReplaced?: (result: AssignmentReplacementResult) => void;
  onLauncherClose?: () => void;
}) {
  const router = useRouter();
  const readyDatasets = useMemo(
    () =>
      datasets.filter(
        (dataset) =>
          dataset.status === "ready" &&
          dataset.isActive &&
          dataset.isAssignable,
      ),
    [datasets],
  );
  const activeStudents = useMemo(
    () => students.filter((student) => student.status === "active"),
    [students],
  );
  const progressByStudent = useMemo(
    () => new Map(progress.map((item) => [item.studentId, item])),
    [progress],
  );
  const pendingReviewIndex = useMemo(
    () =>
      indexStudentPendingReviewSummaries(pendingReviewSummaries),
    [pendingReviewSummaries],
  );
  const currentVocabWrongIndex = useMemo(
    () =>
      indexStudentCurrentVocabWrongSummaries(
        currentVocabWrongSummaries,
      ),
    [currentVocabWrongSummaries],
  );
  const activitiesByStudent = useMemo(
    () => studentLearningActivityIndex(history),
    [history],
  );
  const learningSourcesByStudent = useMemo(() => {
    const index = new Map<string, AssignmentLearningSourceItem[]>();
    for (const source of learningSources) {
      const current = index.get(source.studentId) ?? [];
      current.push(source);
      index.set(source.studentId, current);
    }
    return index;
  }, [learningSources]);
  const initialStudent =
    activeStudents.find((student) => student.id === initialStudentId) ??
    null;

  const [testTab, setTestTab] = useState<"vocab" | "other">("vocab");
  const [query, setQuery] = useState("");
  const [schoolFilter, setSchoolFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [wordbookFilter, setWordbookFilter] = useState("");
  const [wrongWordFilter, setWrongWordFilter] =
    useState<WrongWordStudentFilter>("all");
  const [selectedBulkStudentIds, setSelectedBulkStudentIds] = useState<
    string[]
  >([]);
  const [bulkMode, setBulkMode] = useState<
    "next" | "with_wrong" | null
  >(null);
  const [dialogView, setDialogView] = useState<"overview" | "assign">(
    initialDialogView,
  );
  const [editTarget, setEditTarget] = useState(initialEditTarget);
  const [selectedStudentId, setSelectedStudentId] = useState(
    initialStudent?.id ?? "",
  );
  const [editorBusy, setEditorBusy] = useState(false);
  const [, startRefreshTransition] = useTransition();

  const selectedStudent =
    activeStudents.find((student) => student.id === selectedStudentId) ?? null;
  const selectedProgress = selectedStudent
    ? (progressByStudent.get(selectedStudent.id) ?? null)
    : null;
  const selectedActivities = useMemo(
    () =>
      selectedStudent
        ? projectCurrentAssignmentHistory(
            activitiesByStudent.get(selectedStudent.id) ?? [],
          ).toSorted(compareLearningActivities)
        : [],
    [activitiesByStudent, selectedStudent],
  );
  const selectedLearningSources = selectedStudent
    ? (learningSourcesByStudent.get(selectedStudent.id) ?? []).filter(
        (source) => source.sourceType !== "primary_vocab",
      )
    : [];
  const selectedInitialDatasetId = selectedStudent
    ? readyDatasets.some(
        (dataset) =>
          dataset.id === initialDatasetId && selectedStudent === initialStudent,
      )
      ? initialDatasetId
      : readyDatasets.some(
            (dataset) => dataset.id === selectedStudent.currentVocabDatasetId,
          )
        ? selectedStudent.currentVocabDatasetId!
        : readyDatasets[0]?.id ?? ""
    : "";
  const selectedInitialUnitId = newAssignmentDefaultUnitId(
    selectedProgress,
    selectedInitialDatasetId,
  );
  const selectedReviewCounts =
    selectedStudent && selectedInitialDatasetId
      ? (pendingReviewIndex.byStudentDataset.get(
          pendingReviewSummaryKey(
            selectedStudent.id,
            selectedInitialDatasetId,
          ),
        ) ?? emptyPendingReviewCounts())
      : emptyPendingReviewCounts();
  const selectedCurrentWrongCounts =
    selectedStudent && selectedInitialDatasetId
      ? (currentVocabWrongIndex.byStudentDataset.get(
          currentVocabWrongSummaryKey(
            selectedStudent.id,
            selectedInitialDatasetId,
          ),
        ) ?? emptyCurrentVocabWrongCounts())
      : emptyCurrentVocabWrongCounts();
  const selectedPendingReviewCount = pendingReviewCount(
    selectedReviewCounts,
  );
  const availableReviewLevel1Count =
    selectedReviewCounts.pendingLevel1Count -
    selectedReviewCounts.reservedLevel1Count;
  const availableReviewLevel2Count =
    selectedReviewCounts.pendingLevel2Count -
    selectedReviewCounts.reservedLevel2Count;

  const schoolOptions = useMemo(
    () =>
      Array.from(
        new Set(
          activeStudents
            .map((student) => student.schoolName?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).toSorted(),
    [activeStudents],
  );
  const gradeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          activeStudents
            .map((student) => student.gradeLabel?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).toSorted(),
    [activeStudents],
  );
  const wordbookOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...activeStudents.map((student) =>
              student.currentVocabBook?.trim(),
            ),
            ...learningSources.map((source) => source.displayLabel.trim()),
          ]
            .filter((value): value is string => Boolean(value)),
        ),
      ).toSorted(),
    [activeStudents, learningSources],
  );
  const filteredStudents = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("ko-KR");
    return activeStudents.filter((student) => {
      const searchText = [
        student.displayName,
        student.schoolName,
        student.gradeLabel,
        student.currentVocabBook,
        ...(learningSourcesByStudent.get(student.id) ?? []).map(
          (source) => source.displayLabel,
        ),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ko-KR");
      return (
        (!keyword || searchText.includes(keyword)) &&
        (!schoolFilter || student.schoolName === schoolFilter) &&
        (!gradeFilter || student.gradeLabel === gradeFilter) &&
        (!wordbookFilter ||
          student.currentVocabBook === wordbookFilter ||
          (learningSourcesByStudent.get(student.id) ?? []).some(
            (source) => source.displayLabel === wordbookFilter,
          )) &&
        (() => {
          if (wrongWordFilter === "all") return true;
          if (wrongWordFilter === "retry") {
            return (activitiesByStudent.get(student.id) ?? []).some(
              activityNeedsRetry,
            );
          }
          if (!student.currentVocabDatasetId) return false;
          const wrongCounts =
            currentVocabWrongIndex.byStudentDataset.get(
              currentVocabWrongSummaryKey(
                student.id,
                student.currentVocabDatasetId,
              ),
            ) ?? emptyCurrentVocabWrongCounts();
          if (wrongWordFilter === "repeated") {
            return wrongCounts.repeatedWrongWordCount > 0;
          }
          return wrongCounts.wrongWordCount > 0;
        })()
      );
    }).toSorted((left, right) => {
      const leftActivity = activitiesByStudent.get(left.id)?.[0] ?? null;
      const rightActivity = activitiesByStudent.get(right.id)?.[0] ?? null;
      if (leftActivity && rightActivity) {
        const activityOrder = compareLearningActivities(
          leftActivity,
          rightActivity,
        );
        if (activityOrder !== 0) return activityOrder;
      } else if (leftActivity) {
        return -1;
      } else if (rightActivity) {
        return 1;
      }
      return left.displayName.localeCompare(right.displayName, "ko-KR");
    });
  }, [
    activeStudents,
    activitiesByStudent,
    currentVocabWrongIndex,
    gradeFilter,
    learningSourcesByStudent,
    query,
    schoolFilter,
    wordbookFilter,
    wrongWordFilter,
  ]);
  const selectedBulkStudents = useMemo(
    () =>
      selectedBulkStudentIds.flatMap((selectedId) => {
        const student = activeStudents.find(
          (candidate) => candidate.id === selectedId,
        );
        return student ? [student] : [];
      }),
    [activeStudents, selectedBulkStudentIds],
  );
  const allFilteredStudentsSelected =
    filteredStudents.length > 0 &&
    filteredStudents.every((student) =>
      selectedBulkStudentIds.includes(student.id),
    );

  function toggleBulkStudent(nextStudentId: string) {
    setSelectedBulkStudentIds((current) => {
      if (current.includes(nextStudentId)) {
        return current.filter((studentId) => studentId !== nextStudentId);
      }
      return current.length >= 30 ? current : [...current, nextStudentId];
    });
  }

  function toggleFilteredStudents() {
    const filteredIds = new Set(
      filteredStudents.map((student) => student.id),
    );
    setSelectedBulkStudentIds((current) => {
      if (allFilteredStudentsSelected) {
        return current.filter((studentId) => !filteredIds.has(studentId));
      }
      return Array.from(new Set([...current, ...filteredIds])).slice(0, 30);
    });
  }

  function selectStudent(
    nextStudentId: string,
    nextView: "overview" | "assign" = "overview",
  ) {
    setEditTarget(null);
    setSelectedStudentId(nextStudentId);
    setDialogView(nextView);
  }

  function closeDialog() {
    if (editorBusy) return;
    handleDialogClose();
  }

  function handleDialogClose() {
    setSelectedStudentId("");
    setDialogView("overview");
    setEditTarget(null);
    setEditorBusy(false);
    onLauncherClose?.();
  }

  return (
    <>
      {!launcherOnly ? (
        <>
      <Tabs
        ariaLabel={adminLearningText.page.tabsAria}
        className={styles.managementTabs}
        items={[
          {
            value: "vocab",
            label: adminLearningText.page.vocabularyTab,
            controls: "vocabulary-learning-panel",
            id: "vocabulary-learning-tab",
          },
          {
            value: "other",
            label: adminLearningText.page.otherLearningTab,
            controls: "other-learning-panel",
            id: "other-learning-tab",
          },
        ]}
        onChange={setTestTab}
        value={testTab}
      />

      {testTab === "other" ? (
        <section
          aria-labelledby="other-learning-tab"
          className="empty-state test-type-placeholder"
          id="other-learning-panel"
          role="tabpanel"
        >
          {adminLearningText.page.otherLearningEmpty}
        </section>
      ) : (
        <section
          aria-labelledby="vocabulary-learning-tab"
          className="assignment-student-browser"
          id="vocabulary-learning-panel"
          role="tabpanel"
        >
          <div className="learning-search-panel">
            <label className="learning-search-field">
              <span aria-hidden="true" className="learning-search-icon">
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
                onChange={(event) => setQuery(event.target.value)}
                placeholder={adminLearningText.page.searchPlaceholder}
                type="search"
                value={query}
              />
            </label>
            <details className="learning-filter-disclosure">
              <summary>
                <span>{adminLearningText.page.filterButton}</span>
                <span className="detail-chip">
                  {
                    [schoolFilter, gradeFilter, wordbookFilter].filter(Boolean)
                      .length + (wrongWordFilter === "all" ? 0 : 1)
                  }
                </span>
              </summary>
              <div className="learning-filter-groups">
                <fieldset>
                  <legend>{commonText.filters.wrongAvailability}</legend>
                  <div className="filter-chip-row">
                    {(
                      [
                        ["all", commonText.filters.all],
                        ["wrong", commonText.filters.hasWrong],
                        ["repeated", commonText.filters.repeatedWrong],
                        ["retry", commonText.filters.retryNeeded],
                      ] as const
                    ).map(([value, label]) => (
                      <Button
                        aria-pressed={wrongWordFilter === value}
                        variant="filter"
                        key={value}
                        onClick={() => setWrongWordFilter(value)}
                        size="small"
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>{commonText.filters.bySchool}</legend>
                  <div className="filter-chip-row">
                    {schoolOptions.map((school) => (
                      <Button
                        aria-pressed={schoolFilter === school}
                        variant="filter"
                        key={school}
                        onClick={() =>
                          setSchoolFilter((current) =>
                            current === school ? "" : school,
                          )
                        }
                        size="small"
                      >
                        {school}
                      </Button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>{commonText.filters.byGrade}</legend>
                  <div className="filter-chip-row">
                    {gradeOptions.map((grade) => (
                      <Button
                        aria-pressed={gradeFilter === grade}
                        variant="filter"
                        key={grade}
                        onClick={() =>
                          setGradeFilter((current) =>
                            current === grade ? "" : grade,
                          )
                        }
                        size="small"
                      >
                        {grade}
                      </Button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>{commonText.filters.byWordbook}</legend>
                  <div className="filter-chip-row">
                    {wordbookOptions.map((wordbook) => (
                      <Button
                        aria-pressed={wordbookFilter === wordbook}
                        variant="filter"
                        key={wordbook}
                        onClick={() =>
                          setWordbookFilter((current) =>
                            current === wordbook ? "" : wordbook,
                          )
                        }
                        size="small"
                      >
                        {wordbook}
                      </Button>
                    ))}
                  </div>
                </fieldset>
              </div>
            </details>
            <div className="learning-filter-summary">
              <MetaTagList>
                {schoolFilter ? <MetaTag>{schoolFilter}</MetaTag> : null}
                {gradeFilter ? <MetaTag>{gradeFilter}</MetaTag> : null}
                {wordbookFilter ? <MetaTag>{wordbookFilter}</MetaTag> : null}
                {wrongWordFilter !== "all" ? (
                  <MetaTag tone="warning">
                    {wrongWordFilter === "wrong"
                      ? commonText.filters.hasWrong
                      : wrongWordFilter === "repeated"
                        ? commonText.filters.repeatedWrong
                        : commonText.filters.retryNeeded}
                  </MetaTag>
                ) : null}
              </MetaTagList>
              <div className="learning-filter-summary-actions">
                <strong>
                  {formatContentText(commonText.filters.studentCount, {
                    count: filteredStudents.length,
                  })}
                </strong>
                <Button
                  disabled={
                    !schoolFilter &&
                    !gradeFilter &&
                    !wordbookFilter &&
                    wrongWordFilter === "all"
                  }
                  onClick={() => {
                    setSchoolFilter("");
                    setGradeFilter("");
                    setWordbookFilter("");
                    setWrongWordFilter("all");
                  }}
                  size="small"
                  variant="quiet"
                >
                  {adminLearningText.page.resetFilters}
                </Button>
              </div>
            </div>
          </div>

          <div className="bulk-selection-bar">
            <div className="bulk-selection-summary">
              <strong>
                {formatContentText(adminLearningText.page.bulk.selectedCount, {
                  count: selectedBulkStudentIds.length,
                })}
              </strong>
              <small>{adminLearningText.page.bulk.maximum}</small>
              <Button
                onClick={toggleFilteredStudents}
                size="small"
                variant="quiet"
              >
                {allFilteredStudentsSelected
                  ? adminLearningText.page.bulk.clearVisible
                  : formatContentText(
                      adminLearningText.page.bulk.selectVisible,
                      { count: filteredStudents.length },
                    )}
              </Button>
              {selectedBulkStudentIds.length > 0 ? (
                <Button
                  onClick={() => setSelectedBulkStudentIds([])}
                  size="small"
                  variant="quiet"
                >
                  {adminLearningText.page.bulk.clearAll}
                </Button>
              ) : null}
            </div>
            <div className="bulk-selection-actions">
              <Button
                disabled={selectedBulkStudentIds.length === 0}
                onClick={() => setBulkMode("with_wrong")}
                size="small"
              >
                {adminLearningText.page.bulk.includeWrong}
              </Button>
              <Button
                disabled={selectedBulkStudentIds.length === 0}
                onClick={() => setBulkMode("next")}
                size="small"
                variant="primary"
              >
                {adminLearningText.page.bulk.assignNext}
              </Button>
            </div>
          </div>

          {readyDatasets.length === 0 && (
            <div className="notice notice-warm">
              {adminLearningText.page.bulk.noReadyDatasets}
            </div>
          )}

          {filteredStudents.length === 0 ? (
            <div className="empty-state">
              {adminLearningText.page.noStudents}
            </div>
          ) : (
            <div className="assignment-student-list">
              {filteredStudents.map((student) => {
                const studentProgress =
                  progressByStudent.get(student.id) ?? null;
                const studentActivities =
                  activitiesByStudent.get(student.id) ?? [];
                const nextActivity = studentActivities[0] ?? null;
                const studentLearningSources = (
                  learningSourcesByStudent.get(student.id) ?? []
                ).filter(
                  (source) =>
                    source.sourceType !== "primary_vocab" &&
                    source.displayLabel !== student.currentVocabBook,
                );
                const studentReviewCounts =
                  student.currentVocabDatasetId
                    ? (pendingReviewIndex.byStudentDataset.get(
                        pendingReviewSummaryKey(
                          student.id,
                          student.currentVocabDatasetId,
                        ),
                      ) ?? emptyPendingReviewCounts())
                    : emptyPendingReviewCounts();
                const studentPendingReviewCount =
                  pendingReviewCount(studentReviewCounts);
                const studentAvailableReviewCount =
                  availableReviewCount(studentReviewCounts);
                const recommendedRange = recommendationLabel(studentProgress);
                const currentActivityRange =
                  nextActivity?.primaryUnitLabels[0] ??
                  nextActivity?.unitLabels[0] ??
                  null;
                const showRecommendation =
                  !nextActivity ||
                  !currentActivityRange ||
                  currentActivityRange !== recommendedRange;
                return (
                  <SelectableListRow
                    actions={
                      <>
                        {nextActivity ? (
                          <ButtonLink
                            href={historyDetailHref(nextActivity)}
                            size="small"
                            variant="primary"
                          >
                            {adminLearningText.page.studentCard.view}
                          </ButtonLink>
                        ) : null}
                        <Button
                          disabled={readyDatasets.length === 0}
                          onClick={() => selectStudent(student.id, "assign")}
                          size="small"
                          variant={nextActivity ? "secondary" : "primary"}
                        >
                          {adminLearningText.page.studentCard.newAssignment}
                        </Button>
                      </>
                    }
                    checked={selectedBulkStudentIds.includes(student.id)}
                    checkboxId={`bulk-student-${student.id}`}
                    className="card assignment-student-row"
                    href={
                      nextActivity
                        ? historyDetailHref(nextActivity)
                        : undefined
                    }
                    key={student.id}
                    openAriaLabel={
                      nextActivity
                        ? `${student.displayName} ${assignmentDisplayTitle(nextActivity)} 상세`
                        : undefined
                    }
                    onToggle={() => toggleBulkStudent(student.id)}
                    selectionAriaLabel={formatContentText(
                      adminLearningText.page.bulk.selectStudentAria,
                      { student: student.displayName },
                    )}
                  >
                    <ActivityRowContent
                      main={
                        <>
                          <span className="assignment-student-identity">
                            <strong>{student.displayName}</strong>
                            <MetaTagList>
                              <MetaTag>
                                {student.schoolName ??
                                  adminLearningText.page.studentCard.schoolMissing}
                              </MetaTag>
                              <MetaTag>
                                {student.gradeLabel ??
                                  adminLearningText.page.studentCard.gradeMissing}
                              </MetaTag>
                            </MetaTagList>
                          </span>
                          <MetaTagList className="assignment-student-book">
                            <MetaTag>
                              {student.currentVocabBook ??
                                adminLearningText.page.studentCard.wordbookMissing}
                            </MetaTag>
                            {studentLearningSources.slice(0, 2).map((source) => (
                              <MetaTag key={source.id}>
                                {learningSourceTypeLabel(source.sourceType)} ·{" "}
                                {source.displayLabel}
                              </MetaTag>
                            ))}
                            {studentLearningSources.length > 2 ? (
                              <MetaTag>+{studentLearningSources.length - 2}</MetaTag>
                            ) : null}
                            {studentAvailableReviewCount > 0 ? (
                              <MetaTag tone="warning">
                                {formatContentText(
                                  adminLearningText.page.studentCard.wrongAvailable,
                                  { count: studentAvailableReviewCount },
                                )}
                              </MetaTag>
                            ) : studentPendingReviewCount > 0 ? (
                              <MetaTag>
                                {adminLearningText.page.studentCard.wrongAssigned}
                              </MetaTag>
                            ) : null}
                          </MetaTagList>
                          <span className="assignment-student-recent">
                            {nextActivity ? (
                              <>
                                {assignmentDisplayTitle(nextActivity) ? (
                                  <strong>{assignmentDisplayTitle(nextActivity)}</strong>
                                ) : null}
                                <AssignmentMetaTags {...nextActivity} compact />
                              </>
                            ) : (
                              <strong>{adminLearningText.page.studentCard.noActivity}</strong>
                            )}
                          </span>
                          {showRecommendation ? (
                            <MetaTagList>
                              <MetaTag tone="warning">
                                {formatContentText(
                                  adminLearningText.page.studentCard.recommendedRange,
                                  { range: recommendedRange },
                                )}
                              </MetaTag>
                            </MetaTagList>
                          ) : null}
                        </>
                      }
                      score={
                        nextActivity ? (
                          <AttemptScoreSummary
                            compact
                            finalScore={nextActivity.finalScore}
                            initialScore={nextActivity.initialScore}
                            passingScore={nextActivity.passingScore}
                            phase={nextActivity.phase}
                            retryStartedAt={nextActivity.retryStartedAt}
                            status={nextActivity.status}
                          />
                        ) : undefined
                      }
                      timeline={
                        nextActivity ? (
                          <ActivityStatusTimeline item={nextActivity} />
                        ) : null
                      }
                    />
                  </SelectableListRow>
                );
              })}
            </div>
          )}
        </section>
      )}
        </>
      ) : null}

      {bulkMode && selectedBulkStudents.length > 0 ? (
        <BulkAssignmentDialog
          includePendingReview={bulkMode === "with_wrong"}
          onClose={() => setBulkMode(null)}
          onSuccess={(assignmentCount) => {
            setSelectedBulkStudentIds([]);
            toast.success(
              formatContentText(adminLearningText.page.bulk.success, {
                studentCount: selectedBulkStudents.length,
                assignmentCount,
              }),
            );
            startRefreshTransition(() => router.refresh());
          }}
          students={selectedBulkStudents}
        />
      ) : null}

      {selectedStudent && (
        <AssignmentDialogContainer
          closeDisabled={editorBusy}
          embedded={embedded}
          onRequestClose={closeDialog}
        >
          {!embedded ? <DialogHeader
            backLabel={commonText.modal.back}
            closeLabel={commonText.modal.close}
            onBack={
              dialogView === "assign"
                ? () => {
                    if (launcherOnly) {
                      closeDialog();
                      return;
                    }
                    if (editTarget) {
                      setEditTarget(null);
                    }
                    setEditorBusy(false);
                    setDialogView("overview");
                  }
                : undefined
            }
          >
              <div>
                <h2 id="assignment-dialog-title">
                  {dialogView === "assign"
                    ? editTarget
                      ? adminLearningText.assignmentModal.header.editTitle
                      : adminLearningText.assignmentModal.header.createTitle
                    : selectedStudent.displayName}
                </h2>
                <p>
                  {dialogView === "assign"
                    ? editTarget
                      ? formatContentText(
                          adminLearningText.assignmentModal.overview.beforeStart,
                          { student: selectedStudent.displayName },
                        )
                      : selectedStudent.displayName
                    : [selectedStudent.schoolName, selectedStudent.gradeLabel]
                        .filter(Boolean)
                        .join(" · ") ||
                      adminLearningText.assignmentModal.overview
                        .studentInfoMissing}
                </p>
              </div>
          </DialogHeader> : null}
          {dialogView === "overview" ? (
            <AssignmentDialogBody embedded={embedded}>
              <section className="student-learning-overview">
                <div className="student-learning-source-row">
                  <div>
                    <span>
                      {adminLearningText.assignmentModal.overview.recentWordbook}
                    </span>
                    <strong>
                      {selectedStudent.currentVocabBook ??
                        adminLearningText.assignmentModal.overview.unselected}
                    </strong>
                  </div>
                  <IconButton
                    aria-label={
                      adminLearningText.assignmentModal.overview
                        .openAssignmentAria
                    }
                    className="learning-add-button"
                    disabled={readyDatasets.length === 0}
                    onClick={() => setDialogView("assign")}
                    variant="quiet"
                  >
                    +
                  </IconButton>
                </div>
                {selectedLearningSources.length > 0 ? (
                  <div className="student-learning-tags">
                    <MetaTagList>
                      {selectedLearningSources.map((source) => (
                        <MetaTag
                          key={source.id}
                          tone={
                            source.sourceType === "exam_vocab"
                              ? "warning"
                              : "neutral"
                          }
                        >
                          {learningSourceTypeLabel(source.sourceType)} ·{" "}
                          {source.displayLabel}
                        </MetaTag>
                      ))}
                    </MetaTagList>
                  </div>
                ) : null}
                <div className="student-learning-tags">
                  <MetaTagList>
                    <MetaTag tone="warning">
                      {formatContentText(
                        adminLearningText.assignmentModal.overview
                          .nextRecommendation,
                        { range: recommendationLabel(selectedProgress) },
                      )}
                    </MetaTag>
                    <MetaTag>
                      {formatContentText(
                        adminLearningText.assignmentModal.overview
                          .unresolvedWrong,
                        { count: selectedCurrentWrongCounts.wrongWordCount },
                      )}
                    </MetaTag>
                    <MetaTag>
                      {formatContentText(
                        adminLearningText.assignmentModal.overview.pendingWrong,
                        { count: selectedPendingReviewCount },
                      )}
                    </MetaTag>
                  </MetaTagList>
                  <HelpTip
                    label={
                      adminLearningText.assignmentModal.overview
                        .recommendationHelpAria
                    }
                  >
                    {recommendationReasonLabel(selectedProgress)}
                  </HelpTip>
                </div>
                {readyDatasets.length === 0 ? (
                  <div className="notice notice-warm">
                    {adminLearningText.assignmentModal.overview.noReadyDataset}
                  </div>
                ) : null}
                <div className="learning-section-heading">
                  <h3>
                    {adminLearningText.assignmentModal.overview.recentActivity}
                  </h3>
                  <span className="learning-section-summary">
                    {formatContentText(
                      adminLearningText.assignmentModal.overview.activityCount,
                      { count: selectedActivities.length },
                    )}
                  </span>
                </div>
                <StudentLearningActivityList
                  items={selectedActivities}
                />
              </section>
            </AssignmentDialogBody>
          ) : (
            <SingleAssignmentEditor
              availableReviewLevel1={availableReviewLevel1Count}
              availableReviewLevel2={availableReviewLevel2Count}
              datasets={datasets}
              editTarget={editTarget}
              embedded={embedded}
              initialDatasetId={selectedInitialDatasetId}
              initialUnitId={selectedInitialUnitId}
              key={
                editTarget
                  ? `${selectedStudent.id}:${editTarget.assignmentId}`
                  : `${selectedStudent.id}:create`
              }
              onBusyChange={setEditorBusy}
              onConflict={() =>
                startRefreshTransition(() => router.refresh())
              }
              onSucceeded={(result: SingleAssignmentResult) => {
                if ("status" in result) {
                  onAssignmentReplaced?.(
                    result as AssignmentReplacementResult,
                  );
                }
                startRefreshTransition(() => router.refresh());
                handleDialogClose();
              }}
              progress={selectedProgress}
              student={selectedStudent}
              units={units}
            />
          )}
        </AssignmentDialogContainer>
      )}
    </>
  );
}
