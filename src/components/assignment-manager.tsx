"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { HelpTip } from "@/components/help-tip";
import { BulkAssignmentDialog } from "@/components/bulk-assignment-dialog";
import { ActivityStatusTimeline } from "@/components/activity-status-timeline";
import { AttemptScoreSummary } from "@/components/attempt-score-summary";
import {
  AssignmentMetaTags,
  MetaTag,
  MetaTagList,
} from "@/components/admin-meta-tags";
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
import {
  assignmentEditChangeKeys,
  type AssignmentEditChangeKey,
  type AssignmentEditDraft,
  type AssignmentReplacementResult,
} from "@/lib/admin/assignment-edit";
import {
  activityNeedsRetry,
  compareLearningActivities,
  studentLearningActivityIndex,
} from "@/lib/admin/learning-activity";
import { formatKoreanDateTime } from "@/lib/format";
import {
  currentTimeMilliseconds,
  isoToKoreanDateTimeLocal,
  koreanDateTimeLocalToIso,
} from "@/lib/deadline";
import {
  buildAssignmentSubmission,
  defaultReviewLevels,
  toggleReviewLevel,
  type ReviewLevel,
  type ReviewScope,
} from "@/lib/admin/assignment-submission";
import {
  questionOrderLabel,
  type QuestionOrderMode,
  type TimingMode,
} from "@/lib/admin/assignment-settings";
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
import {
  needsExplicitNewAssignmentRange,
  newAssignmentDefaultUnitId,
} from "@/lib/admin/new-assignment-range";
import { learningSourceTypeLabel } from "@/lib/admin/learning-sources";
import { selectInclusiveUnitRange } from "@/lib/admin/unit-range";
import {
  cataloguedDatasetDisplayLabel,
  groupCataloguedDatasets,
  groupCataloguedUnits,
  type CataloguedDataset,
  type CataloguedUnit,
} from "@/lib/admin/dataset-catalog";
import { adminLearningText } from "@/content/ko/admin-learning";
import { commonText } from "@/content/ko/common";
import { formatContentText } from "@/content/format";
import { Tabs } from "@/components/ui-tabs";
import { SelectField } from "@/components/ui-select";
import {
  ModalBody,
  ModalFooter,
  ModalFrame,
  ModalHeader,
} from "@/components/ui-modal";
import { Button, ButtonLink } from "@/components/ui-button";

export type AssignmentDatasetItem = CataloguedDataset & {
  rowCount: number;
  status: "pending_review" | "ready" | "retired";
  isActive: boolean;
};

export type AssignmentStudentItem = {
  id: string;
  displayName: string;
  schoolName: string | null;
  gradeLabel: string | null;
  currentVocabBook: string | null;
  currentVocabDatasetId: string | null;
  status: "active" | "blocked";
};

export type AssignmentUnitItem = CataloguedUnit & {
  id: string;
  datasetId: string;
  label: string;
  kind: "day" | "supplement";
  number: number | null;
  sortIndex: number;
  entryCount: number;
};

export type AssignmentLearningSourceItem = {
  id: string;
  studentId: string;
  sourceType:
    | "primary_vocab"
    | "exam_vocab"
    | "textbook"
    | "supplement"
    | "mock_exam"
    | "passage";
  vocabDatasetId: string | null;
  displayLabel: string;
  rangeMetadata: Record<string, unknown>;
  sortOrder: number;
};

function AssignmentDialogContainer({
  children,
  dialogRef,
  embedded,
  onCancel,
  onClick,
  onClose,
}: {
  children: ReactNode;
  dialogRef: RefObject<HTMLDialogElement | null>;
  embedded: boolean;
  onCancel: (event: SyntheticEvent<HTMLDialogElement>) => void;
  onClick: (event: MouseEvent<HTMLDialogElement>) => void;
  onClose: () => void;
}) {
  if (embedded) {
    return <>{children}</>;
  }

  return (
    <ModalFrame
      aria-labelledby="assignment-dialog-title"
      className="dialog-extra-wide assignment-dialog"
      onCancel={onCancel}
      onClick={onClick}
      onClose={onClose}
      ref={dialogRef}
    >
      {children}
    </ModalFrame>
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
    <ModalBody
      className={[
        "learning-dialog-body",
        embedded ? "assignment-embedded-body" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </ModalBody>
  );
}

export type AssignmentProgressItem = {
  studentId: string;
  latestAttemptId: string | null;
  latestAssignmentTitle: string | null;
  latestStatus:
    | "not_started"
    | "cancelled"
    | "missed"
    | "in_progress"
    | "completed"
    | "expired"
    | null;
  latestPhase: "initial" | "review" | "retry" | "completed" | null;
  latestScore: number | null;
  latestInitialScore: number | null;
  latestFinalScore: number | null;
  latestPassingScore: number | null;
  latestRetryStartedAt: string | null;
  latestPassed: boolean | null;
  latestUnitLabel: string | null;
  latestAttemptNumber: number | null;
  latestStartedAt: string | null;
  latestCompletedAt: string | null;
  latestCompletedAssignmentTitle: string | null;
  latestCompletedInitialScore: number | null;
  latestCompletedFinalScore: number | null;
  recommendedDatasetId: string | null;
  recommendedUnitId: string | null;
  recommendedUnitLabel: string | null;
  recommendedUnitIds: string[];
  recommendedUnitLabels: string[];
  recommendedDirection: 1 | -1;
  recommendedRangeTruncated: boolean;
  recommendationReason:
    | "assigned"
    | "first"
    | "next"
    | "repeat"
    | "resume"
    | "complete"
    | "manual"
    | null;
};

type ErrorResponse = {
  error?: string;
};

type AssignmentCapacity = {
  eligibleBeforeActiveAssignment: number;
  activeAssignmentExcluded: number;
  questionPlanExcluded: number;
  unitEligible: number;
  wrongEligible: number;
  wrongLevel1Eligible: number;
  wrongLevel2Eligible: number;
  overlap: number;
  alreadyAssigned: number;
  maximumQuestionCount: number;
  recommendedQuestionCount: number;
  minimumQuestionCount: number;
};

type WrongWordStudentFilter = "all" | "wrong" | "repeated" | "retry";

function directionLabel(ratio: number) {
  if (ratio === 100) {
    return adminLearningText.controls.direction.englishToMeaning;
  }
  if (ratio === 0) {
    return adminLearningText.controls.direction.meaningToEnglish;
  }
  return adminLearningText.controls.direction.mixed;
}

function unitRangeLabel(labels: string[]) {
  if (labels.length === 0) {
    return adminLearningText.assignmentModal.range.rangeMissing;
  }
  if (labels.length === 1) return labels[0];
  return `${labels[0]}~${labels.at(-1)}`;
}

function studentAssignmentUrl(
  assignmentId: string,
  studentId: string,
) {
  return `/api/admin/assignments/${assignmentId}/students/${studentId}`;
}

const editChangeLabels: Record<AssignmentEditChangeKey, string> = {
  title: adminLearningText.assignmentModal.submit.optionalTitle,
  dataset: adminLearningText.assignmentModal.range.wordbook,
  range: adminLearningText.assignmentModal.range.groupFallback,
  questionCount: adminLearningText.assignmentModal.conditions.questionCount,
  direction: adminLearningText.controls.direction.label,
  order: adminLearningText.controls.order.label,
  timing: adminLearningText.controls.timing.label,
  passingScore: adminLearningText.controls.passingScore,
  deadline: adminLearningText.assignmentModal.deadline.label,
  review: adminLearningText.assignmentModal.wrongWords.title,
};

type EditComparable = Omit<
  AssignmentEditDraft,
  "assignmentId" | "studentId" | "studentName" | "purpose"
>;

function editValueLabel(
  key: AssignmentEditChangeKey,
  value: EditComparable,
  datasets: readonly AssignmentDatasetItem[],
  units: readonly AssignmentUnitItem[],
) {
  if (key === "title") return value.title;
  if (key === "dataset") {
    const dataset = datasets.find((item) => item.id === value.datasetId);
    return dataset
      ? cataloguedDatasetDisplayLabel(dataset)
      : adminLearningText.assignmentModal.range.unavailableWordbook;
  }
  if (key === "range") {
    return unitRangeLabel(
      value.primaryUnitIds.map(
        (unitId) =>
          units.find((unit) => unit.id === unitId)?.label ??
            adminLearningText.assignmentModal.range.unknownUnit,
      ),
    );
  }
  if (key === "questionCount") {
    return formatContentText(
      adminLearningText.assignmentModal.edit.questionCount,
      { count: value.questionCount },
    );
  }
  if (key === "direction") {
    return directionLabel(value.englishToKoreanRatio);
  }
  if (key === "order") {
    return questionOrderLabel(value.questionOrderMode);
  }
  if (key === "timing") {
    return value.timingMode === "per_question"
      ? formatContentText(
          adminLearningText.assignmentModal.edit.perQuestionTiming,
          { seconds: value.questionTimeLimitSeconds ?? 0 },
        )
      : formatContentText(
          adminLearningText.assignmentModal.edit.totalTiming,
          { minutes: value.timeLimitSeconds / 60 },
        );
  }
  if (key === "passingScore") {
    return formatContentText(adminLearningText.assignmentModal.edit.score, {
      score: value.passingScore,
    });
  }
  if (key === "deadline") {
    return value.availableUntil
      ? formatKoreanDateTime(value.availableUntil)
      : adminLearningText.assignmentModal.edit.noDeadline;
  }
  if (!value.includePendingReview) {
    return adminLearningText.assignmentModal.edit.noWrongWords;
  }
  return value.reviewLevels
    .map((level) =>
      level === 1
        ? adminLearningText.bulkAssignmentModal.wrongOnce
        : adminLearningText.bulkAssignmentModal.wrongRepeated,
    )
    .join(" · ");
}

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestInFlightRef = useRef(false);
  const editIdempotencyRef = useRef<{
    fingerprint: string;
    key: string;
  } | null>(null);
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
  const readyDatasetGroups = useMemo(
    () => groupCataloguedDatasets(readyDatasets),
    [readyDatasets],
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
  const initialStudentDatasetId = readyDatasets.some(
    (dataset) => dataset.id === initialStudent?.currentVocabDatasetId,
  )
    ? initialStudent?.currentVocabDatasetId
    : null;
  const resolvedInitialDatasetId = readyDatasets.some(
    (dataset) => dataset.id === initialDatasetId,
  )
    ? initialDatasetId
    : initialStudentDatasetId ?? readyDatasets[0]?.id ?? "";
  const initialProgress = initialStudent
    ? (progressByStudent.get(initialStudent.id) ?? null)
    : null;
  const initialRecommendedUnitId = newAssignmentDefaultUnitId(
    initialProgress,
    resolvedInitialDatasetId,
  );

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
  const [editDraft, setEditDraft] =
    useState<AssignmentEditDraft | null>(null);
  const [editLoading, setEditLoading] = useState(
    initialEditTarget !== null,
  );
  const [studentId, setStudentId] = useState(initialStudent?.id ?? "");
  const [datasetId, setDatasetId] = useState(resolvedInitialDatasetId);
  const [startUnitId, setStartUnitId] = useState(initialRecommendedUnitId);
  const [endUnitId, setEndUnitId] = useState(initialRecommendedUnitId);
  const [questionCount, setQuestionCount] = useState(20);
  const [directionRatio, setDirectionRatio] = useState<0 | 50 | 100>(50);
  const [questionOrderMode, setQuestionOrderMode] =
    useState<QuestionOrderMode>("random");
  const [timingMode, setTimingMode] = useState<TimingMode>("total");
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(5);
  const [questionTimeLimitSeconds, setQuestionTimeLimitSeconds] =
    useState(20);
  const [passingScore, setPassingScore] = useState(80);
  const [availableUntilLocal, setAvailableUntilLocal] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [includePendingReview, setIncludePendingReview] =
    useState(false);
  const [reviewScope, setReviewScope] =
    useState<ReviewScope>("dataset");
  const [reviewLevels, setReviewLevels] = useState<ReviewLevel[]>(
    defaultReviewLevels,
  );
  const [capacity, setCapacity] =
    useState<AssignmentCapacity | null>(null);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const [capacityError, setCapacityError] = useState("");
  const [capacityRefreshVersion, setCapacityRefreshVersion] =
    useState(0);
  const [questionCountMode, setQuestionCountMode] = useState<
    "auto" | "manual"
  >("auto");
  const questionCountModeRef = useRef<"auto" | "manual">("auto");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refreshPending, startRefreshTransition] = useTransition();

  function changeQuestionCountMode(mode: "auto" | "manual") {
    questionCountModeRef.current = mode;
    setQuestionCountMode(mode);
  }

  const selectedStudent =
    activeStudents.find((student) => student.id === studentId) ?? null;
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
  const selectedDatasetRecord =
    datasets.find((dataset) => dataset.id === datasetId) ?? null;
  const selectedDataset =
    readyDatasets.find((dataset) => dataset.id === datasetId) ?? null;
  const selectedReviewCounts =
    selectedStudent && datasetId
      ? (pendingReviewIndex.byStudentDataset.get(
          pendingReviewSummaryKey(selectedStudent.id, datasetId),
        ) ?? emptyPendingReviewCounts())
      : emptyPendingReviewCounts();
  const selectedCurrentWrongCounts =
    selectedStudent && datasetId
      ? (currentVocabWrongIndex.byStudentDataset.get(
          currentVocabWrongSummaryKey(selectedStudent.id, datasetId),
        ) ?? emptyCurrentVocabWrongCounts())
      : emptyCurrentVocabWrongCounts();
  const selectedPendingReviewCount = pendingReviewCount(
    selectedReviewCounts,
  );
  const selectedAvailableReviewTotal = availableReviewCount(
    selectedReviewCounts,
  );
  const availableReviewLevel1Count =
    selectedReviewCounts.pendingLevel1Count -
    selectedReviewCounts.reservedLevel1Count;
  const availableReviewLevel2Count =
    selectedReviewCounts.pendingLevel2Count -
    selectedReviewCounts.reservedLevel2Count;
  const datasetUnits = useMemo(
    () =>
      units
        .filter((unit) => unit.datasetId === datasetId)
        .toSorted((left, right) => left.sortIndex - right.sortIndex),
    [datasetId, units],
  );
  const datasetUnitGroups = useMemo(
    () => groupCataloguedUnits(datasetUnits),
    [datasetUnits],
  );
  const needsExplicitUnitSelection = needsExplicitNewAssignmentRange(
    selectedProgress,
    datasetId,
  );
  const effectiveStartUnitId =
    startUnitId ||
    (needsExplicitUnitSelection ? "" : datasetUnits[0]?.id) ||
    "";
  const effectiveEndUnitId =
    effectiveStartUnitId
      ? endUnitId || effectiveStartUnitId
      : "";
  const selectedUnits = selectInclusiveUnitRange(
    datasetUnits,
    effectiveStartUnitId,
    effectiveEndUnitId,
  );
  const usesDayLabels =
    datasetUnits.length > 0 &&
    datasetUnits.every((unit) => unit.kind === "day");
  const unitTerm = usesDayLabels
    ? adminLearningText.assignmentModal.range.dayTerm
    : adminLearningText.assignmentModal.range.unitTerm;
  const availableWordCount = selectedUnits.reduce(
    (total, unit) => total + unit.entryCount,
    0,
  );
  const selectedUnitLabels = selectedUnits.map((unit) => unit.displayName);
  const selectedUnitIdsKey = selectedUnits
    .map((unit) => unit.id)
    .join(",");
  const reviewLevelsKey = reviewLevels.join(",");
  const generatedTitle = [
    selectedDataset
      ? cataloguedDatasetDisplayLabel(selectedDataset)
      : null,
    unitRangeLabel(selectedUnitLabels),
    includePendingReview
      ? formatContentText(
          adminLearningText.assignmentModal.overview.includedWrong,
          { count: capacity?.wrongEligible ?? 0 },
        )
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const finalTitle = customTitle.trim() || generatedTitle;
  const timeLimitSeconds =
    timingMode === "total" ? timeLimitMinutes * 60 : 10800;
  const normalizedAvailableUntil = availableUntilLocal
    ? koreanDateTimeLocalToIso(availableUntilLocal)
    : null;
  const currentEditValues = editDraft
    ? {
        title: finalTitle.trim(),
        datasetId,
        primaryUnitIds: selectedUnits.map((unit) => unit.id),
        questionCount,
        englishToKoreanRatio: directionRatio,
        timeLimitSeconds,
        timingMode,
        questionTimeLimitSeconds:
          timingMode === "per_question"
            ? questionTimeLimitSeconds
            : null,
        passingScore,
        questionOrderMode,
        availableUntil: normalizedAvailableUntil,
        includePendingReview,
        reviewLevels: [...reviewLevels].toSorted(),
      }
    : null;
  const editChanges =
    editDraft && currentEditValues
      ? assignmentEditChangeKeys(editDraft, currentEditValues)
      : [];
  const editComparisons =
    editDraft && currentEditValues
      ? editChanges.map((key) => ({
          key,
          label: editChangeLabels[key],
          before: editValueLabel(key, editDraft, datasets, units),
          after: editValueLabel(
            key,
            currentEditValues,
            datasets,
            units,
          ),
        }))
      : [];
  const editRebuildsQuestions = editChanges.some((change) =>
    ["dataset", "range", "questionCount", "direction", "review"].includes(
      change,
    ),
  );
  const minimumAllowedQuestionCount =
    editDraft?.purpose === "review" ? 1 : 4;
  const exactReviewEdit = editDraft?.purpose === "review";
  const capacityInvalid =
    !capacity ||
    capacity.maximumQuestionCount < minimumAllowedQuestionCount ||
    questionCount < capacity.minimumQuestionCount ||
    questionCount > capacity.maximumQuestionCount ||
    (includePendingReview && capacity.wrongEligible < 1);
  const cannotCreate =
    !studentId ||
    !datasetId ||
    !selectedDataset ||
    selectedUnits.length === 0 ||
    questionCount < minimumAllowedQuestionCount ||
    questionCount > 500 ||
    capacityInvalid ||
    capacityLoading ||
    Boolean(capacityError) ||
    editLoading ||
    (editTarget !== null &&
      (editDraft === null || editChanges.length === 0)) ||
    (timingMode === "total" &&
      (timeLimitSeconds < 30 || timeLimitSeconds > 10800)) ||
    (timingMode === "per_question" &&
      (questionTimeLimitSeconds < 5 ||
        questionTimeLimitSeconds > 600)) ||
    submitting ||
    refreshPending;

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

  useEffect(() => {
    if (!embedded && selectedStudent && !dialogRef.current?.open) {
      dialogRef.current?.showModal();
    }
  }, [embedded, selectedStudent]);

  useEffect(() => {
    if (!editTarget) return;
    const controller = new AbortController();
    void fetch(
      studentAssignmentUrl(
        editTarget.assignmentId,
        editTarget.studentId,
      ),
      {
        cache: "no-store",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const payload = (await response.json()) as
          | AssignmentEditDraft
          | ErrorResponse;
        if (!response.ok || !("assignmentId" in payload)) {
          throw new Error(
            "error" in payload
              ? payload.error
              : adminLearningText.assignmentModal.errors.editLoad,
          );
        }
        if (
          payload.assignmentId !== editTarget.assignmentId ||
          payload.studentId !== editTarget.studentId
        ) {
          throw new Error(
            adminLearningText.assignmentModal.errors.editMismatch,
          );
        }
        const deadlineLocal = isoToKoreanDateTimeLocal(
          payload.availableUntil,
        );
        const normalizedDraft: AssignmentEditDraft = {
          ...payload,
          questionOrderMode:
            payload.questionOrderMode === "fixed"
              ? "ascending"
              : payload.questionOrderMode,
          availableUntil: deadlineLocal
            ? koreanDateTimeLocalToIso(deadlineLocal)
            : null,
        };
        setEditDraft(normalizedDraft);
        setDatasetId(payload.datasetId);
        setStartUnitId(payload.primaryUnitIds[0] ?? "");
        setEndUnitId(payload.primaryUnitIds.at(-1) ?? "");
        setQuestionCount(payload.questionCount);
        changeQuestionCountMode("manual");
        setDirectionRatio(payload.englishToKoreanRatio);
        setQuestionOrderMode(
          payload.questionOrderMode === "fixed"
            ? "ascending"
            : payload.questionOrderMode,
        );
        setTimingMode(payload.timingMode);
        setTimeLimitMinutes(payload.timeLimitSeconds / 60);
        setQuestionTimeLimitSeconds(
          payload.questionTimeLimitSeconds ?? 20,
        );
        setPassingScore(payload.passingScore);
        setAvailableUntilLocal(deadlineLocal);
        setCustomTitle(payload.title);
        setIncludePendingReview(payload.includePendingReview);
        setReviewLevels(
          payload.reviewLevels.length > 0
            ? payload.reviewLevels
            : defaultReviewLevels(),
        );
        setCapacity(null);
        setCapacityError("");
        editIdempotencyRef.current = null;
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : adminLearningText.assignmentModal.errors.editLoad,
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setEditLoading(false);
      });

    return () => controller.abort();
  }, [editTarget]);

  useEffect(() => {
    if (
      !studentId ||
      !datasetId ||
      !selectedUnitIdsKey ||
      (editTarget !== null && editDraft === null)
    ) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setCapacityLoading(true);
      setCapacityError("");
      void fetch(
        editTarget
          ? studentAssignmentUrl(
              editTarget.assignmentId,
              editTarget.studentId,
            )
          : "/api/admin/assignment-capacity",
        {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          studentId,
          datasetId,
          primaryUnitIds: selectedUnitIdsKey.split(","),
          includePendingReview,
          reviewLevels,
          reviewScope,
          englishToKoreanRatio: directionRatio,
        }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = (await response.json()) as
            | AssignmentCapacity
            | ErrorResponse;
          if (!response.ok || !("maximumQuestionCount" in payload)) {
            throw new Error(
              "error" in payload
                ? payload.error
                : adminLearningText.assignmentModal.errors.capacity,
            );
          }
          setCapacity(payload);
          setQuestionCount((current) => {
            if (
              payload.maximumQuestionCount <
              payload.minimumQuestionCount
            ) {
              return current;
            }
            if (
              questionCountModeRef.current === "auto" &&
              payload.recommendedQuestionCount >=
                minimumAllowedQuestionCount
            ) {
              return payload.recommendedQuestionCount;
            }
            return Math.min(
              payload.maximumQuestionCount,
              Math.max(payload.minimumQuestionCount, current),
            );
          });
        })
        .catch((requestError: unknown) => {
          if (controller.signal.aborted) return;
          setCapacity(null);
          setCapacityError(
            requestError instanceof Error
              ? requestError.message
              : adminLearningText.assignmentModal.errors.capacity,
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setCapacityLoading(false);
          }
        });
    }, 120);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    datasetId,
    directionRatio,
    includePendingReview,
    minimumAllowedQuestionCount,
    reviewLevels,
    reviewLevelsKey,
    reviewScope,
    capacityRefreshVersion,
    selectedUnitIdsKey,
    studentId,
    editTarget,
    editDraft,
  ]);

  function resetScopedControls() {
    setIncludePendingReview(false);
    setReviewScope("dataset");
    setReviewLevels(defaultReviewLevels());
    changeQuestionCountMode("auto");
    setCapacity(null);
    setCapacityError("");
    setAvailableUntilLocal("");
    setCustomTitle("");
    setError("");
  }

  function resetUntouchedEditTitle() {
    if (editTarget && editDraft && customTitle === editDraft.title) {
      setCustomTitle("");
    }
  }

  function selectStudent(
    nextStudentId: string,
    nextView: "overview" | "assign" = "overview",
  ) {
    setEditTarget(null);
    setEditDraft(null);
    setEditLoading(false);
    editIdempotencyRef.current = null;
    const student = activeStudents.find(
      (candidate) => candidate.id === nextStudentId,
    );
    const currentDatasetIsReady = readyDatasets.some(
      (dataset) => dataset.id === student?.currentVocabDatasetId,
    );
    const nextDatasetId =
      (currentDatasetIsReady
        ? student?.currentVocabDatasetId
        : null) ??
      readyDatasets[0]?.id ??
      "";
    const nextProgress = progressByStudent.get(nextStudentId) ?? null;
    const nextRecommendedUnitId = newAssignmentDefaultUnitId(
      nextProgress,
      nextDatasetId,
    );

    setStudentId(nextStudentId);
    setDialogView(nextView);
    setDatasetId(nextDatasetId);
    setStartUnitId(nextRecommendedUnitId);
    setEndUnitId(nextRecommendedUnitId);
    resetScopedControls();
  }

  function selectDataset(nextDatasetId: string) {
    const nextRecommendedUnitId = newAssignmentDefaultUnitId(
      selectedProgress,
      nextDatasetId,
    );
    setDatasetId(nextDatasetId);
    setStartUnitId(nextRecommendedUnitId);
    setEndUnitId(nextRecommendedUnitId);
    resetUntouchedEditTitle();
    if (editTarget) {
      changeQuestionCountMode("manual");
      setCapacity(null);
      setCapacityError("");
      setError("");
      editIdempotencyRef.current = null;
      return;
    }
    resetScopedControls();
  }

  function selectStartUnit(nextStartId: string) {
    changeQuestionCountMode("auto");
    setCapacity(null);
    setCapacityError("");
    setStartUnitId(nextStartId);
    resetUntouchedEditTitle();
    setError("");
  }

  function closeDialog() {
    if (submitting) return;
    if (embedded) {
      handleDialogClose();
      return;
    }
    dialogRef.current?.close();
  }

  function closeDialogOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (!submitting && event.target === event.currentTarget) {
      closeDialog();
    }
  }

  function handleDialogClose() {
    setStudentId("");
    setDialogView("overview");
    setEditTarget(null);
    setEditDraft(null);
    setEditLoading(false);
    editIdempotencyRef.current = null;
    resetScopedControls();
    onLauncherClose?.();
  }

  function handleDialogCancel(
    event: SyntheticEvent<HTMLDialogElement>,
  ) {
    if (submitting) event.preventDefault();
  }

  function changeReviewLevel(level: ReviewLevel) {
    changeQuestionCountMode("auto");
    setCapacity(null);
    setCapacityError("");
    setReviewLevels((current) =>
      toggleReviewLevel(current, level),
    );
    setError("");
  }

  function changeIncludePendingReview(checked: boolean) {
    changeQuestionCountMode("auto");
    setCapacity(null);
    setCapacityError("");
    setIncludePendingReview(checked);
    if (!checked) setReviewScope("dataset");
    setError("");
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlightRef.current) return;
    setError("");
    const availableUntil = availableUntilLocal
      ? koreanDateTimeLocalToIso(availableUntilLocal)
      : null;
    if (
      availableUntilLocal &&
      (!availableUntil ||
        Date.parse(availableUntil) <= currentTimeMilliseconds())
    ) {
      setError(adminLearningText.assignmentModal.deadline.invalid);
      return;
    }
    requestInFlightRef.current = true;
    setSubmitting(true);

    try {
      const commonSubmission = {
        studentId,
        datasetId,
        primaryUnitIds: selectedUnits.map((unit) => unit.id),
        title: editTarget ? finalTitle : customTitle,
        questionCount,
        englishToKoreanRatio: directionRatio,
        timeLimitSeconds,
        timingMode,
        questionTimeLimitSeconds:
          timingMode === "per_question"
            ? questionTimeLimitSeconds
            : null,
        passingScore,
        questionOrderMode,
        availableUntil,
      };
      let response: Response;
      if (editTarget) {
        const replacementBody = {
          title: finalTitle,
          datasetId,
          primaryUnitIds: commonSubmission.primaryUnitIds,
          includePendingReview,
          reviewLevels,
          questionCount,
          englishToKoreanRatio: directionRatio,
          timeLimitSeconds,
          timingMode,
          questionTimeLimitSeconds:
            timingMode === "per_question"
              ? questionTimeLimitSeconds
              : null,
          passingScore,
          questionOrderMode,
          availableUntil,
        };
        const fingerprint = JSON.stringify(replacementBody);
        if (
          !editIdempotencyRef.current ||
          editIdempotencyRef.current.fingerprint !== fingerprint
        ) {
          editIdempotencyRef.current = {
            fingerprint,
            key: crypto.randomUUID(),
          };
        }
        response = await fetch(
          studentAssignmentUrl(
            editTarget.assignmentId,
            editTarget.studentId,
          ),
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              idempotencyKey: editIdempotencyRef.current.key,
              ...replacementBody,
            }),
          },
        );
      } else {
        const submission = includePendingReview
          ? buildAssignmentSubmission({
              ...commonSubmission,
              includePendingReview: true,
              reviewLevels,
              reviewScope,
            })
          : buildAssignmentSubmission({
              ...commonSubmission,
              includePendingReview: false,
            });
        response = await fetch(submission.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(submission.body),
        });
      }
      const payload = (await response.json()) as ErrorResponse &
        Partial<AssignmentReplacementResult>;

      if (!response.ok) {
        if (response.status === 409) {
          setCapacityRefreshVersion((version) => version + 1);
          startRefreshTransition(() => router.refresh());
        }
        throw new Error(
          payload.error ?? adminLearningText.assignmentModal.errors.generic,
        );
      }

      const studentName =
        selectedStudent?.displayName ??
        adminLearningText.assignmentModal.success.studentFallback;
      const successMessage = editTarget
        ? formatContentText(
            adminLearningText.assignmentModal.success.edited,
            { student: studentName },
          )
        : includePendingReview
          ? formatContentText(
              adminLearningText.assignmentModal.success.assignedWithWrong,
              { student: studentName },
            )
          : formatContentText(
              adminLearningText.assignmentModal.success.assigned,
              { student: studentName },
            );
      if (editTarget) {
        if (
          payload.status !== "replaced" ||
          !payload.replacementAssignmentId ||
          !payload.studentId ||
          !payload.sourceAssignmentId ||
          !payload.replacementPurpose ||
          typeof payload.idempotent !== "boolean"
        ) {
          throw new Error(adminLearningText.assignmentModal.errors.generic);
        }
        onAssignmentReplaced?.({
          status: payload.status,
          replacementAssignmentId: payload.replacementAssignmentId,
          studentId: payload.studentId,
          sourceAssignmentId: payload.sourceAssignmentId,
          replacementPurpose: payload.replacementPurpose,
          idempotent: payload.idempotent,
        });
      }
      toast.success(successMessage);
      if (!editTarget) {
        setAvailableUntilLocal("");
        setCustomTitle("");
      }
      startRefreshTransition(() => router.refresh());
      closeDialog();
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : adminLearningText.assignmentModal.errors.generic;
      toast.error(message);
    } finally {
      requestInFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <>
      {!launcherOnly ? (
        <>
      <Tabs
        ariaLabel={adminLearningText.page.tabsAria}
        className="management-tabs"
        items={[
          {
            value: "vocab",
            label: adminLearningText.page.vocabularyTab,
            controls: "vocabulary-learning-panel",
          },
          {
            value: "other",
            label: adminLearningText.page.otherLearningTab,
            controls: "other-learning-panel",
          },
        ]}
        onChange={setTestTab}
        value={testTab}
      />

      {testTab === "other" ? (
        <section
          className="empty-state test-type-placeholder"
          id="other-learning-panel"
          role="tabpanel"
        >
          {adminLearningText.page.otherLearningEmpty}
        </section>
      ) : (
        <section
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
              <input
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
                        className="filter-chip"
                        key={value}
                        onClick={() => setWrongWordFilter(value)}
                        size="small"
                        variant="quiet"
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
                        className="filter-chip"
                        key={school}
                        onClick={() =>
                          setSchoolFilter((current) =>
                            current === school ? "" : school,
                          )
                        }
                        size="small"
                        variant="quiet"
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
                        className="filter-chip"
                        key={grade}
                        onClick={() =>
                          setGradeFilter((current) =>
                            current === grade ? "" : grade,
                          )
                        }
                        size="small"
                        variant="quiet"
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
                        className="filter-chip"
                        key={wordbook}
                        onClick={() =>
                          setWordbookFilter((current) =>
                            current === wordbook ? "" : wordbook,
                          )
                        }
                        size="small"
                        variant="quiet"
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
                      nextActivity ? (
                        <ButtonLink
                          href={historyDetailHref(nextActivity)}
                          size="small"
                          variant="primary"
                        >
                          {adminLearningText.page.studentCard.view}
                        </ButtonLink>
                      ) : (
                        <Button
                          onClick={() => selectStudent(student.id, "assign")}
                          size="small"
                          variant="primary"
                        >
                          {adminLearningText.page.studentCard.assign}
                        </Button>
                      )
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
          dialogRef={dialogRef}
          embedded={embedded}
          onCancel={handleDialogCancel}
          onClick={closeDialogOnBackdrop}
          onClose={handleDialogClose}
        >
          {!embedded ? <ModalHeader
            disabled={submitting}
            onBack={
              dialogView === "assign"
                ? () => {
                    if (launcherOnly) {
                      closeDialog();
                      return;
                    }
                    if (editTarget) {
                      setEditTarget(null);
                      setEditDraft(null);
                      setEditLoading(false);
                      editIdempotencyRef.current = null;
                      resetScopedControls();
                    }
                    setDialogView("overview");
                  }
                : undefined
            }
            onClose={closeDialog}
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
          </ModalHeader> : null}
          <AssignmentDialogBody embedded={embedded}>
            {dialogView === "overview" ? (
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
                  <Button
                    aria-label={
                      adminLearningText.assignmentModal.overview
                        .openAssignmentAria
                    }
                    className="learning-add-button"
                    disabled={readyDatasets.length === 0}
                    onClick={() => setDialogView("assign")}
                    size="icon"
                    variant="quiet"
                  >
                    +
                  </Button>
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
                  <span>
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
            ) : (
              <>
                <div className="assignment-dialog-context">
                  <MetaTagList>
                    <MetaTag>
                      {selectedStudent.currentVocabBook ??
                        adminLearningText.page.studentCard.wordbookMissing}
                    </MetaTag>
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
                          .pendingWrongShort,
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

                {editLoading ? (
                  <div className="notice" role="status">
                    {adminLearningText.assignmentModal.overview.loadingEdit}
                  </div>
                ) : null}

          <form
            aria-busy={submitting}
            className="assignment-modal-form"
            id="assignment-modal-form"
            onSubmit={submitAssignment}
          >
            <fieldset
                className="assignment-modal-fieldset"
                disabled={
                  submitting ||
                  refreshPending ||
                  editLoading ||
                  (editTarget !== null && editDraft === null)
                }
              >
                <legend className="sr-only">
                  {adminLearningText.assignmentModal.overview.formAria}
                </legend>
            <section className="assignment-step">
              <div className="assignment-step-heading">
                <span>1</span>
                <div>
                  <h3>
                    {adminLearningText.assignmentModal.range.title}
                    <HelpTip
                      label={formatContentText(
                        adminLearningText.assignmentModal.range.helpAria,
                        { unit: unitTerm },
                      )}
                    >
                      {adminLearningText.assignmentModal.range.help}
                    </HelpTip>
                  </h3>
                </div>
              </div>
              {exactReviewEdit ? (
                <div className="notice">
                  {adminLearningText.assignmentModal.edit.lockedReview}
                </div>
              ) : null}
              {!editTarget &&
              needsExplicitUnitSelection &&
              !startUnitId ? (
                <div className="notice notice-warm">
                  {
                    adminLearningText.assignmentModal.range
                      .activeAssignmentSelectionRequired
                  }
                </div>
              ) : null}
              <label className="field">
                <span className="field-label">
                  {adminLearningText.assignmentModal.range.wordbook}
                </span>
                <SelectField
                  disabled={exactReviewEdit}
                  onChange={(event) =>
                    selectDataset(event.target.value)
                  }
                  required
                  value={datasetId}
                >
                  <option disabled value="">
                    {adminLearningText.assignmentModal.range.selectWordbook}
                  </option>
                  {datasetId &&
                  !readyDatasets.some(
                    (dataset) => dataset.id === datasetId,
                  ) ? (
                    <option disabled value={datasetId}>
                      {selectedDatasetRecord
                        ? cataloguedDatasetDisplayLabel(selectedDatasetRecord)
                        : adminLearningText.assignmentModal.range
                            .previousWordbook}{" "}
                      · {adminLearningText.assignmentModal.range.assignmentClosed}
                    </option>
                  ) : null}
                  {readyDatasetGroups.map((group) => (
                    <optgroup key={group.group} label={group.label}>
                      {group.datasets.map((dataset) => (
                        <option key={dataset.id} value={dataset.id}>
                          {cataloguedDatasetDisplayLabel(dataset)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </SelectField>
              </label>
              <div className="form-grid-2">
                <label className="field">
                  <span className="field-label">
                    {formatContentText(
                      adminLearningText.assignmentModal.range.start,
                      { unit: unitTerm },
                    )}
                  </span>
                  <SelectField
                    disabled={exactReviewEdit}
                    onChange={(event) =>
                      selectStartUnit(event.target.value)
                    }
                    required
                    value={effectiveStartUnitId}
                  >
                    <option disabled value="">
                      {formatContentText(
                        adminLearningText.assignmentModal.range.selectStart,
                        { unit: unitTerm },
                      )}
                    </option>
                    {datasetUnitGroups.map((group) => (
                      <optgroup
                        key={group.group ?? "range"}
                        label={
                          group.label ??
                          adminLearningText.assignmentModal.range.groupFallback
                        }
                      >
                        {group.units.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {formatContentText(
                              adminLearningText.assignmentModal.range
                                .unitEntryCount,
                              {
                                unit: unit.displayName,
                                count: unit.entryCount,
                              },
                            )}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </SelectField>
                </label>
                <label className="field">
                  <span className="field-label">
                    {formatContentText(
                      adminLearningText.assignmentModal.range.end,
                      { unit: unitTerm },
                    )}
                  </span>
                  <SelectField
                    disabled={exactReviewEdit}
                    onChange={(event) => {
                      changeQuestionCountMode("auto");
                      setCapacity(null);
                      setCapacityError("");
                      setEndUnitId(event.target.value);
                      resetUntouchedEditTitle();
                      setError("");
                    }}
                    required
                    value={effectiveEndUnitId}
                  >
                    <option disabled value="">
                      {formatContentText(
                        adminLearningText.assignmentModal.range.selectEnd,
                        { unit: unitTerm },
                      )}
                    </option>
                    {datasetUnitGroups.map((group) => (
                      <optgroup
                        key={group.group ?? "range"}
                        label={
                          group.label ??
                          adminLearningText.assignmentModal.range.groupFallback
                        }
                      >
                        {group.units.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {formatContentText(
                              adminLearningText.assignmentModal.range
                                .unitEntryCount,
                              {
                                unit: unit.displayName,
                                count: unit.entryCount,
                              },
                            )}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </SelectField>
                </label>
              </div>
              <p className="selection-summary">
                {formatContentText(
                  adminLearningText.assignmentModal.range.sourceWordCount,
                  {
                    range: unitRangeLabel(selectedUnitLabels),
                    count: availableWordCount.toLocaleString(),
                  },
                )}
              </p>
              {capacity && !exactReviewEdit ? (
                <p
                  aria-live="polite"
                  className="selection-capacity-summary"
                >
                  <span>
                    {formatContentText(
                      adminLearningText.assignmentModal.range
                        .eligibleWordCount,
                      {
                        count:
                          capacity.eligibleBeforeActiveAssignment.toLocaleString(),
                      },
                    )}
                  </span>
                  {availableWordCount >
                  capacity.eligibleBeforeActiveAssignment ? (
                    <span>
                      {formatContentText(
                        adminLearningText.assignmentModal.range
                          .sourceExcluded,
                        {
                          count: (
                            availableWordCount -
                            capacity.eligibleBeforeActiveAssignment
                          ).toLocaleString(),
                        },
                      )}
                    </span>
                  ) : null}
                  {capacity.activeAssignmentExcluded > 0 ? (
                    <span>
                      {formatContentText(
                        adminLearningText.assignmentModal.range
                          .activeAssignmentExcluded,
                        {
                          count:
                            capacity.activeAssignmentExcluded.toLocaleString(),
                        },
                      )}
                    </span>
                  ) : null}
                  {capacity.questionPlanExcluded > 0 ? (
                    <span>
                      {formatContentText(
                        adminLearningText.assignmentModal.range
                          .questionPlanExcluded,
                        {
                          count:
                            capacity.questionPlanExcluded.toLocaleString(),
                        },
                      )}
                    </span>
                  ) : null}
                  <strong>
                    {formatContentText(
                      adminLearningText.assignmentModal.range
                        .maximumQuestionCount,
                      {
                        count:
                          capacity.maximumQuestionCount.toLocaleString(),
                      },
                    )}
                  </strong>
                  {capacity.activeAssignmentExcluded > 0 ? (
                    <HelpTip
                      label={
                        adminLearningText.assignmentModal.range
                          .activeAssignmentHelpAria
                      }
                    >
                      {
                        adminLearningText.assignmentModal.range
                          .activeAssignmentHelp
                      }
                    </HelpTip>
                  ) : null}
                </p>
              ) : null}
              <fieldset
                aria-label={adminLearningText.assignmentModal.wrongWords.title}
                className="assignment-review-options"
              >
                <div className="assignment-review-toggle-row">
                  <label className="assignment-review-switch">
                    <input
                      checked={includePendingReview}
                      disabled={exactReviewEdit}
                      onChange={(event) =>
                        changeIncludePendingReview(event.target.checked)
                      }
                      type="checkbox"
                    />
                    <strong>
                      {adminLearningText.assignmentModal.wrongWords.title}
                    </strong>
                  </label>
                  <HelpTip
                    label={
                      adminLearningText.assignmentModal.wrongWords.helpAria
                    }
                  >
                    {adminLearningText.assignmentModal.wrongWords.help}
                  </HelpTip>
                </div>
                <div
                  aria-live="polite"
                  className="assignment-review-counts"
                >
                  <span>
                    {formatContentText(
                      adminLearningText.assignmentModal.wrongWords
                        .countSummary,
                      {
                        label:
                          adminLearningText.assignmentModal.wrongWords.total,
                        count: capacity
                          ? capacity.wrongLevel1Eligible +
                            capacity.wrongLevel2Eligible
                          : selectedAvailableReviewTotal,
                      },
                    )}
                  </span>
                  <span>
                    {formatContentText(
                      adminLearningText.assignmentModal.wrongWords
                        .countSummary,
                      {
                        label:
                          adminLearningText.assignmentModal.wrongWords.once,
                        count:
                          capacity?.wrongLevel1Eligible ??
                          availableReviewLevel1Count,
                      },
                    )}
                  </span>
                  <span>
                    {formatContentText(
                      adminLearningText.assignmentModal.wrongWords
                        .countSummary,
                      {
                        label:
                          adminLearningText.assignmentModal.wrongWords.repeated,
                        count:
                          capacity?.wrongLevel2Eligible ??
                          availableReviewLevel2Count,
                      },
                    )}
                  </span>
                </div>
                {includePendingReview && (
                  <div className="assignment-review-controls">
                    <fieldset className="field timing-mode-field">
                      <legend className="field-label label-with-help">
                        {adminLearningText.assignmentModal.wrongWords.scopeLabel}
                        <HelpTip
                          label={
                            adminLearningText.assignmentModal.wrongWords
                              .scopeHelpAria
                          }
                        >
                          {adminLearningText.assignmentModal.wrongWords.scopeHelp}
                        </HelpTip>
                      </legend>
                      <div className="segmented-control">
                        <Button
                          aria-pressed={reviewScope === "dataset"}
                          disabled={editTarget !== null}
                          onClick={() => {
                            setReviewScope("dataset");
                            changeQuestionCountMode("auto");
                            setCapacity(null);
                            setCapacityError("");
                            setError("");
                          }}
                        >
                          {adminLearningText.assignmentModal.wrongWords.scopeAll}
                        </Button>
                        <Button
                          aria-pressed={reviewScope === "selection"}
                          disabled={editTarget !== null}
                          onClick={() => {
                            setReviewScope("selection");
                            changeQuestionCountMode("auto");
                            setCapacity(null);
                            setCapacityError("");
                            setError("");
                          }}
                        >
                          {adminLearningText.assignmentModal.wrongWords.scopeCurrent}
                        </Button>
                      </div>
                    </fieldset>
                    <div
                      aria-label={
                        adminLearningText.assignmentModal.wrongWords
                          .levelGroupAria
                      }
                      className="filter-chip-row"
                      role="group"
                    >
                      <Button
                        aria-pressed={reviewLevels.includes(1)}
                        className="filter-chip"
                        disabled={exactReviewEdit}
                        onClick={() => changeReviewLevel(1)}
                        size="small"
                        variant="quiet"
                      >
                        {adminLearningText.assignmentModal.wrongWords.once}
                      </Button>
                      <Button
                        aria-pressed={reviewLevels.includes(2)}
                        className="filter-chip"
                        disabled={exactReviewEdit}
                        onClick={() => changeReviewLevel(2)}
                        size="small"
                        variant="quiet"
                      >
                        {adminLearningText.assignmentModal.wrongWords.repeated}
                      </Button>
                    </div>
                  </div>
                )}
              </fieldset>
            </section>

            <section className="assignment-step">
              <div className="assignment-step-heading">
                <span>2</span>
                <div>
                  <h3>
                    {adminLearningText.assignmentModal.conditions.title}
                    <HelpTip
                      label={
                        adminLearningText.assignmentModal.conditions.helpAria
                      }
                    >
                      {adminLearningText.assignmentModal.conditions.help}
                    </HelpTip>
                  </h3>
                </div>
              </div>
              <div className="form-grid-2">
                <label className="field">
                  <span className="field-label">
                    {adminLearningText.assignmentModal.conditions.direction}
                  </span>
                  <SelectField
                    onChange={(event) => {
                      changeQuestionCountMode("auto");
                      setCapacity(null);
                      setCapacityError("");
                      setDirectionRatio(
                        Number(event.target.value) as 0 | 50 | 100,
                      );
                      setError("");
                    }}
                    value={directionRatio}
                  >
                    <option value={100}>
                      {adminLearningText.controls.direction.englishToMeaning}
                    </option>
                    <option value={0}>
                      {adminLearningText.controls.direction.meaningToEnglish}
                    </option>
                    <option value={50}>
                      {adminLearningText.controls.direction.mixed}
                    </option>
                    <option disabled>
                      {adminLearningText.assignmentModal.conditions
                        .englishDefinitionDisabled}
                    </option>
                    <option disabled>
                      {adminLearningText.assignmentModal.conditions
                        .exampleDisabled}
                    </option>
                  </SelectField>
                </label>
                <label className="field">
                  <span className="field-label">
                    {adminLearningText.assignmentModal.conditions.order}
                  </span>
                  <SelectField
                    onChange={(event) =>
                      setQuestionOrderMode(
                        event.target.value as QuestionOrderMode,
                      )
                    }
                    value={questionOrderMode}
                  >
                    <option value="ascending">
                      {adminLearningText.controls.order.ascending}
                    </option>
                    <option value="descending">
                      {adminLearningText.controls.order.descending}
                    </option>
                    <option value="random">
                      {adminLearningText.controls.order.random}
                    </option>
                  </SelectField>
                </label>
              </div>
              <div className="assignment-condition-grid">
                <div className="field">
                  <span className="field-label">
                    <label htmlFor="assignment-question-count">
                      {includePendingReview
                        ? adminLearningText.assignmentModal.conditions
                            .totalQuestionCount
                        : adminLearningText.assignmentModal.conditions
                            .questionCount}
                    </label>
                  </span>
                  <input
                    id="assignment-question-count"
                    max={
                      capacity &&
                      capacity.maximumQuestionCount >=
                        minimumAllowedQuestionCount
                        ? capacity.maximumQuestionCount
                        : 500
                    }
                    min={
                      capacity?.minimumQuestionCount ??
                      minimumAllowedQuestionCount
                    }
                    onChange={(event) => {
                      changeQuestionCountMode("manual");
                      setQuestionCount(Number(event.target.value));
                      setError("");
                    }}
                    required
                    type="number"
                    readOnly={exactReviewEdit}
                    value={questionCount}
                  />
                  {questionCountMode === "manual" &&
                    capacity &&
                    capacity.recommendedQuestionCount >=
                      minimumAllowedQuestionCount &&
                    capacity.recommendedQuestionCount !==
                      questionCount && (
                      <Button
                        onClick={() => {
                          changeQuestionCountMode("auto");
                          setQuestionCount(
                            capacity.recommendedQuestionCount,
                          );
                        }}
                        size="small"
                        variant="quiet"
                      >
                        {formatContentText(
                          adminLearningText.assignmentModal.conditions
                            .restoreRecommended,
                          { count: capacity.recommendedQuestionCount },
                        )}
                      </Button>
                    )}
                </div>
                <fieldset className="field timing-mode-field">
                  <legend className="field-label label-with-help">
                    {adminLearningText.assignmentModal.conditions.timingMode}
                    <HelpTip
                      label={adminLearningText.controls.timing.helpAria}
                    >
                      {adminLearningText.assignmentModal.conditions.timingHelp}
                    </HelpTip>
                  </legend>
                  <div className="segmented-control">
                    <Button
                      aria-pressed={timingMode === "total"}
                      onClick={() => setTimingMode("total")}
                    >
                      {adminLearningText.controls.timing.total}
                    </Button>
                    <Button
                      aria-pressed={timingMode === "per_question"}
                      onClick={() => setTimingMode("per_question")}
                    >
                      {adminLearningText.controls.timing.perQuestion}
                    </Button>
                  </div>
                </fieldset>
                <label className="field">
                  <span className="field-label">
                    {timingMode === "total"
                      ? adminLearningText.assignmentModal.conditions.totalTime
                      : adminLearningText.assignmentModal.conditions
                          .perQuestionTime}
                  </span>
                  {timingMode === "total" ? (
                    <input
                      max={180}
                      min={0.5}
                      onChange={(event) =>
                        setTimeLimitMinutes(Number(event.target.value))
                      }
                      required
                      step={0.5}
                      type="number"
                      value={timeLimitMinutes}
                    />
                  ) : (
                    <input
                      max={600}
                      min={5}
                      onChange={(event) =>
                        setQuestionTimeLimitSeconds(
                          Number(event.target.value),
                        )
                      }
                      required
                      type="number"
                      value={questionTimeLimitSeconds}
                    />
                  )}
                </label>
                <label className="field">
                  <span className="field-label">
                    {adminLearningText.assignmentModal.conditions.passingScore}
                  </span>
                  <input
                    max={100}
                    min={0}
                    onChange={(event) =>
                      setPassingScore(Number(event.target.value))
                    }
                    required
                    type="number"
                    value={passingScore}
                  />
                </label>
              </div>
              <div className="field">
                <span className="field-label label-with-help">
                  <label htmlFor="assignment-available-until">
                    {adminLearningText.assignmentModal.deadline.label}
                  </label>
                  <HelpTip
                    label={adminLearningText.assignmentModal.deadline.helpAria}
                  >
                    {adminLearningText.assignmentModal.deadline.help}
                  </HelpTip>
                </span>
                <input
                  id="assignment-available-until"
                  onChange={(event) => {
                    setAvailableUntilLocal(event.target.value);
                    setError("");
                  }}
                  step={60}
                  type="datetime-local"
                  value={availableUntilLocal}
                />
              </div>
            </section>

            <section className="assignment-submit-panel">
              <div className="field">
                <span className="field-label label-with-help">
                  <label htmlFor="assignment-custom-title">
                    {adminLearningText.assignmentModal.submit.optionalTitle}
                  </label>
                  <HelpTip label={adminLearningText.controls.titleHelpAria}>
                    {adminLearningText.assignmentModal.submit.titleHelp}
                  </HelpTip>
                </span>
                <input
                  id="assignment-custom-title"
                  maxLength={160}
                  onChange={(event) => {
                    setCustomTitle(event.target.value);
                    setError("");
                  }}
                  placeholder={
                    generatedTitle ||
                    adminLearningText.assignmentModal.submit.autoTitle
                  }
                  value={customTitle}
                />
              </div>
              {editDraft ? (
                <section
                  aria-label={
                    adminLearningText.assignmentModal.edit.comparisonAria
                  }
                  className="assignment-edit-comparison"
                >
                  <div className="assignment-edit-comparison-heading">
                    <strong className="label-with-help">
                      {adminLearningText.assignmentModal.edit.comparisonTitle}
                      {editRebuildsQuestions ? (
                        <HelpTip
                          label={
                            adminLearningText.assignmentModal.edit
                              .rebuildHelpAria
                          }
                        >
                          {adminLearningText.assignmentModal.edit.rebuildQuestionsHelp}
                        </HelpTip>
                      ) : null}
                    </strong>
                    <span>
                      {formatContentText(
                        adminLearningText.assignmentModal.edit.changedCount,
                        { count: editComparisons.length },
                      )}
                    </span>
                  </div>
                  {editComparisons.length > 0 ? (
                    <dl>
                      {editComparisons.map((comparison) => (
                        <div key={comparison.key}>
                          <dt>{comparison.label}</dt>
                          <dd>
                            <span>
                              <span className="sr-only">
                                {adminLearningText.assignmentModal.edit.before}
                              </span>
                              {comparison.before}
                            </span>
                            <span aria-hidden="true">→</span>
                            <strong>
                              <span className="sr-only">
                                {adminLearningText.assignmentModal.edit.after}
                              </span>
                              {comparison.after}
                            </strong>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p>{adminLearningText.assignmentModal.edit.unchanged}</p>
                  )}
                </section>
              ) : null}
              {capacityLoading && (
                <span className="sr-only" role="status">
                  {adminLearningText.assignmentModal.errors.capacityLoading}
                </span>
              )}
              {capacityError && (
                <div className="notice notice-error" role="alert">
                  {capacityError}
                </div>
              )}
              {includePendingReview &&
                capacity &&
                capacity.wrongEligible === 0 && (
                  <div className="notice notice-error" role="alert">
                    {adminLearningText.assignmentModal.wrongWords.noEligible}
                  </div>
                )}
              {capacity &&
                capacity.maximumQuestionCount <
                  capacity.minimumQuestionCount && (
                  <div className="notice notice-error" role="alert">
                    {formatContentText(
                      adminLearningText.assignmentModal.errors
                        .rangeUnavailable,
                      { count: capacity.maximumQuestionCount },
                    )}
                  </div>
                )}
              {capacity &&
                capacity.maximumQuestionCount >=
                  capacity.minimumQuestionCount &&
                questionCount > capacity.maximumQuestionCount && (
                  <div className="notice notice-error" role="alert">
                    {formatContentText(
                      adminLearningText.assignmentModal.errors.maximumDetail,
                      { count: capacity.maximumQuestionCount },
                    )}
                  </div>
                )}
              {capacity &&
                capacity.maximumQuestionCount >=
                  capacity.minimumQuestionCount &&
                questionCount < capacity.minimumQuestionCount && (
                  <div className="notice notice-error" role="alert">
                    {formatContentText(
                      adminLearningText.assignmentModal.errors.minimumDetail,
                      { count: capacity.minimumQuestionCount },
                    )}
                  </div>
                )}
              {(questionCount < minimumAllowedQuestionCount ||
                  questionCount > 500) && (
                  <div className="notice notice-error" role="alert">
                  {formatContentText(
                    adminLearningText.assignmentModal.errors.countDetail,
                    { min: minimumAllowedQuestionCount },
                  )}
                </div>
              )}
              {timingMode === "total" &&
                (timeLimitSeconds < 30 ||
                  timeLimitSeconds > 10800) && (
                <div className="notice notice-error" role="alert">
                  {adminLearningText.assignmentModal.errors.totalTimeDetail}
                </div>
              )}
              {timingMode === "per_question" &&
                (questionTimeLimitSeconds < 5 ||
                  questionTimeLimitSeconds > 600) && (
                  <div className="notice notice-error" role="alert">
                    {adminLearningText.assignmentModal.errors.perQuestionDetail}
                  </div>
                )}
              {error && (
                <div className="notice notice-error" role="alert">
                  {error}
                </div>
              )}
            </section>
            </fieldset>
          </form>
              </>
            )}
          </AssignmentDialogBody>
          {dialogView === "assign" ? (
            <ModalFooter>
              <Button
                disabled={cannotCreate}
                form="assignment-modal-form"
                size="large"
                type="submit"
                variant="primary"
              >
                {submitting
                  ? editTarget
                    ? adminLearningText.assignmentModal.submit.saving
                    : adminLearningText.assignmentModal.submit.assigning
                  : refreshPending
                    ? adminLearningText.assignmentModal.submit.refreshing
                    : editTarget
                      ? editComparisons.length > 0
                        ? adminLearningText.assignmentModal.submit.saveChanges
                        : adminLearningText.assignmentModal.submit.noChanges
                      : includePendingReview
                        ? adminLearningText.assignmentModal.submit.assignWithWrong
                        : adminLearningText.assignmentModal.submit.assign}
              </Button>
            </ModalFooter>
          ) : null}
        </AssignmentDialogContainer>
      )}
    </>
  );
}
