"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type MouseEvent,
  type SyntheticEvent,
} from "react";
import { useRouter } from "next/navigation";

import { HelpTip } from "@/components/help-tip";
import { BulkAssignmentDialog } from "@/components/bulk-assignment-dialog";
import {
  AttemptScoreSummary,
  AttemptStatusLabel,
} from "@/components/attempt-score-summary";
import { MetaTag, MetaTagList } from "@/components/admin-meta-tags";
import { StudentLearningActivityList } from "@/components/student-learning-activity-list";
import {
  assignmentDisplayTitle,
  type AssignmentHistorySummary,
} from "@/lib/admin/history";
import {
  assignmentEditChangeKeys,
  type AssignmentEditChangeKey,
  type AssignmentEditDraft,
} from "@/lib/admin/assignment-edit";
import {
  activityNeedsRetry,
  compareLearningActivities,
  learningActivityEffectiveAt,
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
  reservedReviewCount,
  type StudentPendingReviewSummary,
} from "@/lib/admin/review-queue-summary";
import {
  currentVocabWrongSummaryKey,
  emptyCurrentVocabWrongCounts,
  indexStudentCurrentVocabWrongSummaries,
  type StudentCurrentVocabWrongSummary,
} from "@/lib/admin/wrong-history-summary";
import { learningSourceTypeLabel } from "@/lib/admin/learning-sources";
import {
  cataloguedDatasetDisplayLabel,
  groupCataloguedDatasets,
  groupCataloguedUnits,
  type CataloguedDataset,
  type CataloguedUnit,
} from "@/lib/admin/dataset-catalog";

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
  unitEligible: number;
  wrongEligible: number;
  overlap: number;
  alreadyAssigned: number;
  maximumQuestionCount: number;
  recommendedQuestionCount: number;
  minimumQuestionCount: number;
};

type WrongWordStudentFilter = "all" | "wrong" | "repeated" | "retry";

function directionLabel(ratio: number) {
  if (ratio === 100) return "영어 → 뜻";
  if (ratio === 0) return "뜻 → 영어";
  return "영어 ↔ 뜻 혼합";
}

function unitRangeLabel(labels: string[]) {
  if (labels.length === 0) return "범위 미선택";
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
  title: "시험 이름",
  dataset: "단어장",
  range: "범위",
  questionCount: "문항 수",
  direction: "출제 방식",
  order: "문제 순서",
  timing: "시간 제한",
  passingScore: "통과 점수",
  deadline: "응시 시작 마감",
  review: "틀렸던 단어",
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
      : "사용할 수 없는 단어장";
  }
  if (key === "range") {
    return unitRangeLabel(
      value.primaryUnitIds.map(
        (unitId) =>
          units.find((unit) => unit.id === unitId)?.label ?? "알 수 없음",
      ),
    );
  }
  if (key === "questionCount") return `${value.questionCount}문항`;
  if (key === "direction") {
    return directionLabel(value.englishToKoreanRatio);
  }
  if (key === "order") {
    return questionOrderLabel(value.questionOrderMode);
  }
  if (key === "timing") {
    return value.timingMode === "per_question"
      ? `문제당 ${value.questionTimeLimitSeconds ?? 0}초`
      : `전체 ${value.timeLimitSeconds / 60}분`;
  }
  if (key === "passingScore") return `${value.passingScore}점`;
  if (key === "deadline") {
    return value.availableUntil
      ? formatKoreanDateTime(value.availableUntil)
      : "마감 없음";
  }
  if (!value.includePendingReview) return "추가 안 함";
  return value.reviewLevels
    .map((level) => (level === 1 ? "한 번 틀림" : "두 번 이상 틀림"))
    .join(" · ");
}

function recommendationLabel(progress: AssignmentProgressItem | null) {
  if (!progress) return "단어장 선택 필요";
  if (progress.recommendationReason === "complete") {
    return "현재 단어장 완료";
  }
  if (progress.recommendationReason === "assigned") {
    return `${progress.recommendedUnitLabel ?? "배정 범위"} 미응시`;
  }
  if (progress.recommendationReason === "resume") {
    return `${progress.recommendedUnitLabel ?? "최근 범위"} 이어서`;
  }
  if (progress.recommendationReason === "repeat") {
    return `${progress.recommendedUnitLabel ?? "최근 범위"} 다시 배정`;
  }
  if (progress.recommendationReason === "manual") {
    return "과거 시험의 DAY 범위 직접 확인";
  }
  return progress.recommendedUnitLabel ?? "첫 DAY 선택";
}

function recommendationReasonLabel(progress: AssignmentProgressItem | null) {
  if (!progress) return "현재 단어장을 먼저 선택하세요.";
  if (progress.recommendationReason === "assigned") {
    return "이미 배정했지만 아직 시작하지 않은 범위입니다.";
  }
  if (progress.recommendationReason === "resume") {
    return "진행 중인 시험을 이어서 완료해야 합니다.";
  }
  if (progress.recommendationReason === "repeat") {
    return "최근 결과가 통과 기준에 못 미쳐 같은 범위를 권합니다.";
  }
  if (progress.recommendationReason === "next") {
    return "최근 범위를 통과해 다음 범위를 권합니다.";
  }
  if (progress.recommendationReason === "first") {
    return "현재 단어장의 첫 범위부터 시작합니다.";
  }
  if (progress.recommendationReason === "complete") {
    return "현재 단어장의 마지막 범위까지 통과했습니다.";
  }
  return "과거 자료에 범위 연결이 없어 직접 확인이 필요합니다.";
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
  const initialRecommendedUnitId =
    initialProgress?.recommendedDatasetId === resolvedInitialDatasetId
      ? (initialProgress.recommendedUnitId ?? "")
      : "";

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
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refreshPending, startRefreshTransition] = useTransition();

  const selectedStudent =
    activeStudents.find((student) => student.id === studentId) ?? null;
  const selectedProgress = selectedStudent
    ? (progressByStudent.get(selectedStudent.id) ?? null)
    : null;
  const selectedActivities = selectedStudent
    ? (activitiesByStudent.get(selectedStudent.id) ?? [])
    : [];
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
  const selectedReservedReviewCount = reservedReviewCount(
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
  const datasetUnitIndex = useMemo(
    () => new Map(datasetUnits.map((unit, index) => [unit.id, index])),
    [datasetUnits],
  );
  const needsManualUnitSelection =
    selectedProgress?.recommendationReason === "manual" &&
    selectedProgress.recommendedDatasetId === datasetId;
  const effectiveStartUnitId =
    startUnitId ||
    (needsManualUnitSelection ? "" : datasetUnits[0]?.id) ||
    "";
  const effectiveEndUnitId =
    endUnitId || effectiveStartUnitId || datasetUnits[0]?.id || "";
  const startIndex = datasetUnits.findIndex(
    (unit) => unit.id === effectiveStartUnitId,
  );
  const endIndex = datasetUnits.findIndex(
    (unit) => unit.id === effectiveEndUnitId,
  );
  const selectedUnits =
    startIndex < 0 || endIndex < startIndex
      ? []
      : datasetUnits.slice(startIndex, endIndex + 1);
  const usesDayLabels =
    datasetUnits.length > 0 &&
    datasetUnits.every((unit) => unit.kind === "day");
  const unitTerm = usesDayLabels ? "DAY" : "단원";
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
      ? `틀렸던 단어 ${capacity?.wrongEligible ?? 0}개 포함`
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
    Boolean(success) ||
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
    if (selectedStudent && !dialogRef.current?.open) {
      dialogRef.current?.showModal();
    }
  }, [selectedStudent]);

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
              : "수정할 배정 정보를 불러오지 못했습니다.",
          );
        }
        if (
          payload.assignmentId !== editTarget.assignmentId ||
          payload.studentId !== editTarget.studentId
        ) {
          throw new Error("수정할 배정 정보가 일치하지 않습니다.");
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
        setQuestionCountMode("manual");
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
            : "수정할 배정 정보를 불러오지 못했습니다.",
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
                : "문항 수를 계산하지 못했습니다.",
            );
          }
          setCapacity(payload);
          setQuestionCount((current) => {
            if (questionCountMode === "auto") {
              return payload.recommendedQuestionCount || current;
            }
            if (editTarget) return current;
            return current > payload.maximumQuestionCount
              ? payload.maximumQuestionCount
              : current;
          });
        })
        .catch((requestError: unknown) => {
          if (controller.signal.aborted) return;
          setCapacity(null);
          setCapacityError(
            requestError instanceof Error
              ? requestError.message
              : "문항 수를 계산하지 못했습니다.",
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
    questionCountMode,
    reviewLevels,
    reviewLevelsKey,
    capacityRefreshVersion,
    selectedUnitIdsKey,
    studentId,
    editTarget,
    editDraft,
  ]);

  function resetScopedControls() {
    setIncludePendingReview(false);
    setReviewLevels(defaultReviewLevels());
    setQuestionCountMode("auto");
    setCapacity(null);
    setCapacityError("");
    setAvailableUntilLocal("");
    setCustomTitle("");
    setError("");
    setSuccess("");
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
    const nextRecommendedUnitId =
      nextProgress?.recommendedDatasetId === nextDatasetId
        ? (nextProgress.recommendedUnitId ?? "")
        : "";

    setStudentId(nextStudentId);
    setDialogView(nextView);
    setDatasetId(nextDatasetId);
    setStartUnitId(nextRecommendedUnitId);
    setEndUnitId(nextRecommendedUnitId);
    resetScopedControls();
  }

  function selectDataset(nextDatasetId: string) {
    const nextRecommendedUnitId =
      selectedProgress?.recommendedDatasetId === nextDatasetId
        ? (selectedProgress.recommendedUnitId ?? "")
        : "";
    setDatasetId(nextDatasetId);
    setStartUnitId(nextRecommendedUnitId);
    setEndUnitId(nextRecommendedUnitId);
    if (editTarget) {
      setQuestionCountMode("manual");
      setCapacity(null);
      setCapacityError("");
      setError("");
      setSuccess("");
      editIdempotencyRef.current = null;
      return;
    }
    resetScopedControls();
  }

  function beginEdit(item: AssignmentHistorySummary) {
    setStudentId(item.studentId);
    setDialogView("assign");
    setEditTarget({
      assignmentId: item.assignmentId,
      studentId: item.studentId,
    });
    setEditDraft(null);
    setEditLoading(true);
    setError("");
    setSuccess("");
    editIdempotencyRef.current = null;
  }

  function selectStartUnit(nextStartId: string) {
    setQuestionCountMode("auto");
    setStartUnitId(nextStartId);
    setError("");
    setSuccess("");
    const nextStartIndex = datasetUnits.findIndex(
      (unit) => unit.id === nextStartId,
    );
    const currentEndIndex = datasetUnits.findIndex(
      (unit) => unit.id === effectiveEndUnitId,
    );
    if (currentEndIndex < nextStartIndex) {
      setEndUnitId(nextStartId);
    }
  }

  function closeDialog() {
    if (submitting) return;
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
    setQuestionCountMode("auto");
    setReviewLevels((current) =>
      toggleReviewLevel(current, level),
    );
    setError("");
    setSuccess("");
  }

  function changeIncludePendingReview(checked: boolean) {
    setQuestionCountMode("auto");
    setIncludePendingReview(checked);
    setError("");
    setSuccess("");
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlightRef.current) return;
    setError("");
    setSuccess("");
    const availableUntil = availableUntilLocal
      ? koreanDateTimeLocalToIso(availableUntilLocal)
      : null;
    if (
      availableUntilLocal &&
      (!availableUntil ||
        Date.parse(availableUntil) <= currentTimeMilliseconds())
    ) {
      setError("응시 시작 마감은 현재보다 뒤의 한국시간으로 정해주세요.");
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
      const payload = (await response.json()) as ErrorResponse;

      if (!response.ok) {
        if (response.status === 409) {
          setCapacityRefreshVersion((version) => version + 1);
          startRefreshTransition(() => router.refresh());
        }
        throw new Error(
          payload.error ?? "단어 시험을 배정하지 못했습니다.",
        );
      }

      setSuccess(
        editTarget
          ? `${selectedStudent?.displayName ?? "학생"}의 미응시 배정을 수정했습니다.`
          : includePendingReview
          ? `${selectedStudent?.displayName ?? "학생"}에게 틀렸던 단어를 포함해 배정했습니다.`
          : `${selectedStudent?.displayName ?? "학생"}에게 배정했습니다.`,
      );
      if (!editTarget) {
        setAvailableUntilLocal("");
        setCustomTitle("");
      }
      startRefreshTransition(() => router.refresh());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "단어 시험을 배정하지 못했습니다.",
      );
    } finally {
      requestInFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <>
      {!launcherOnly ? (
        <>
      <div
        aria-label="시험 종류"
        className="management-tabs"
      >
        <button
          aria-pressed={testTab === "vocab"}
          className="management-tab"
          onClick={() => setTestTab("vocab")}
          type="button"
        >
          단어
        </button>
        <button
          aria-pressed={testTab === "other"}
          className="management-tab"
          onClick={() => setTestTab("other")}
          type="button"
        >
          다른 학습
        </button>
      </div>

      {testTab === "other" ? (
        <section className="empty-state test-type-placeholder">
          지문·해석·문법·모의고사 학습 구조가 확정되면 이곳에서
          관리합니다.
        </section>
      ) : (
        <section className="assignment-student-browser">
          <div className="learning-search-panel">
            <label className="learning-search-field">
              <span aria-hidden="true" className="learning-search-icon">
                <svg viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="6" />
                  <path d="m16 16 4 4" />
                </svg>
              </span>
              <span className="sr-only">학생 및 학습 자료 검색</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="이름·학교·학년·단어장 검색"
                type="search"
                value={query}
              />
            </label>
            <details className="learning-filter-disclosure">
              <summary>
                <span>필터</span>
                <span className="detail-chip">
                  {
                    [schoolFilter, gradeFilter, wordbookFilter].filter(Boolean)
                      .length + (wrongWordFilter === "all" ? 0 : 1)
                  }
                </span>
              </summary>
              <div className="learning-filter-groups">
                <fieldset>
                  <legend>오답 유무</legend>
                  <div className="filter-chip-row">
                    {(
                      [
                        ["all", "전체"],
                        ["wrong", "오답 있음"],
                        ["repeated", "2회 이상 오답"],
                        ["retry", "재시험 필요"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        aria-pressed={wrongWordFilter === value}
                        className="filter-chip"
                        key={value}
                        onClick={() => setWrongWordFilter(value)}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>학교별</legend>
                  <div className="filter-chip-row">
                    {schoolOptions.map((school) => (
                      <button
                        aria-pressed={schoolFilter === school}
                        className="filter-chip"
                        key={school}
                        onClick={() =>
                          setSchoolFilter((current) =>
                            current === school ? "" : school,
                          )
                        }
                        type="button"
                      >
                        {school}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>학년별</legend>
                  <div className="filter-chip-row">
                    {gradeOptions.map((grade) => (
                      <button
                        aria-pressed={gradeFilter === grade}
                        className="filter-chip"
                        key={grade}
                        onClick={() =>
                          setGradeFilter((current) =>
                            current === grade ? "" : grade,
                          )
                        }
                        type="button"
                      >
                        {grade}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>단어장별</legend>
                  <div className="filter-chip-row">
                    {wordbookOptions.map((wordbook) => (
                      <button
                        aria-pressed={wordbookFilter === wordbook}
                        className="filter-chip"
                        key={wordbook}
                        onClick={() =>
                          setWordbookFilter((current) =>
                            current === wordbook ? "" : wordbook,
                          )
                        }
                        type="button"
                      >
                        {wordbook}
                      </button>
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
                      ? "오답 있음"
                      : wrongWordFilter === "repeated"
                        ? "2회 이상 오답"
                        : "재시험 필요"}
                  </MetaTag>
                ) : null}
              </MetaTagList>
              <div className="learning-filter-summary-actions">
                <strong>{filteredStudents.length}명</strong>
                <button
                  className="button button-quiet button-small"
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
                  type="button"
                >
                  초기화
                </button>
              </div>
            </div>
          </div>

          <div className="bulk-selection-bar">
            <div className="bulk-selection-summary">
              <strong>{selectedBulkStudentIds.length}명 선택</strong>
              <small>최대 30명</small>
              <button
                className="button button-quiet button-small"
                onClick={toggleFilteredStudents}
                type="button"
              >
                {allFilteredStudentsSelected
                  ? "현재 목록 선택 해제"
                  : `현재 목록 ${filteredStudents.length}명 선택`}
              </button>
              {selectedBulkStudentIds.length > 0 ? (
                <button
                  className="button button-quiet button-small"
                  onClick={() => setSelectedBulkStudentIds([])}
                  type="button"
                >
                  전체 해제
                </button>
              ) : null}
            </div>
            <div className="bulk-selection-actions">
              <button
                className="button button-secondary button-small"
                disabled={selectedBulkStudentIds.length === 0}
                onClick={() => setBulkMode("with_wrong")}
                type="button"
              >
                틀린 단어 포함
              </button>
              <button
                className="button button-primary button-small"
                disabled={selectedBulkStudentIds.length === 0}
                onClick={() => setBulkMode("next")}
                type="button"
              >
                다음 범위 일괄 배정
              </button>
            </div>
          </div>

          {readyDatasets.length === 0 && (
            <div className="notice notice-warm">
              검수가 끝난 단어장이 없어 아직 시험을 배정할 수
              없습니다.
            </div>
          )}

          {filteredStudents.length === 0 ? (
            <div className="empty-state">
              조건에 맞는 접속 가능 학생이 없습니다.
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
                  <article
                    className="card assignment-student-row"
                    key={student.id}
                  >
                    <label className="assignment-student-select">
                      <input
                        aria-label={`${student.displayName} 일괄 배정 선택`}
                        checked={selectedBulkStudentIds.includes(student.id)}
                        onChange={() => toggleBulkStudent(student.id)}
                        type="checkbox"
                      />
                    </label>
                    <span className="assignment-student-identity">
                      <strong>{student.displayName}</strong>
                      <MetaTagList>
                        <MetaTag>{student.schoolName ?? "학교 미입력"}</MetaTag>
                        <MetaTag>{student.gradeLabel ?? "학년 미입력"}</MetaTag>
                      </MetaTagList>
                    </span>
                    <span className="assignment-student-book">
                      <MetaTagList>
                        <MetaTag>
                          {student.currentVocabBook ?? "단어장 미선택"}
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
                            틀린 단어 {studentAvailableReviewCount}개 추가 가능
                          </MetaTag>
                        ) : studentPendingReviewCount > 0 ? (
                          <MetaTag>틀린 단어 배정 중</MetaTag>
                        ) : null}
                      </MetaTagList>
                    </span>
                    <span className="assignment-student-recent">
                      <strong>
                        {nextActivity
                          ? assignmentDisplayTitle(nextActivity)
                          : "배정된 학습 없음"}
                      </strong>
                      {showRecommendation ? (
                        <MetaTagList>
                          <MetaTag tone="warning">
                            추천 범위 · {recommendedRange}
                          </MetaTag>
                        </MetaTagList>
                      ) : null}
                      {nextActivity ? (
                        <>
                          <small>
                            {nextActivity.status === "not_started"
                              ? nextActivity.availableUntil
                                ? `마감 ${formatKoreanDateTime(nextActivity.availableUntil)}`
                                : `배정 ${formatKoreanDateTime(nextActivity.assignedAt)} · 마감 없음`
                              : nextActivity.completedAt
                                ? `종료 ${formatKoreanDateTime(nextActivity.completedAt)}`
                                : `${nextActivity.status === "expired" ? "시간 종료 " : ""}${formatKoreanDateTime(
                                    learningActivityEffectiveAt(nextActivity),
                                  )}`}
                          </small>
                          <span className="assignment-student-score-line">
                            <AttemptStatusLabel
                              finalScore={nextActivity.finalScore}
                              initialScore={nextActivity.initialScore}
                              passingScore={nextActivity.passingScore}
                              phase={nextActivity.phase}
                              retryStartedAt={nextActivity.retryStartedAt}
                              status={nextActivity.status}
                            />
                            <AttemptScoreSummary
                              finalScore={nextActivity.finalScore}
                              initialScore={nextActivity.initialScore}
                              passingScore={nextActivity.passingScore}
                              phase={nextActivity.phase}
                              retryStartedAt={nextActivity.retryStartedAt}
                              status={nextActivity.status}
                            />
                          </span>
                        </>
                      ) : null}
                    </span>
                    <div className="assignment-student-actions">
                      <button
                        className="button button-primary button-small"
                        onClick={() =>
                          selectStudent(
                            student.id,
                            nextActivity ? "overview" : "assign",
                          )
                        }
                        type="button"
                      >
                        {nextActivity ? "보기" : "배정"}
                      </button>
                    </div>
                  </article>
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
          onSuccess={() => {
            setSelectedBulkStudentIds([]);
            startRefreshTransition(() => router.refresh());
          }}
          students={selectedBulkStudents}
        />
      ) : null}

      {selectedStudent && (
        <dialog
          aria-labelledby="assignment-dialog-title"
          className="dialog dialog-extra-wide assignment-dialog"
          onCancel={handleDialogCancel}
          onClick={closeDialogOnBackdrop}
          onClose={handleDialogClose}
          ref={dialogRef}
        >
          <div className="dialog-heading learning-dialog-heading">
            <div className="learning-dialog-title-row">
              {dialogView === "assign" ? (
                <button
                  aria-label={
                    launcherOnly
                      ? "학생 학습 관리로 돌아가기"
                      : "학습 관리로 돌아가기"
                  }
                  className="button button-quiet button-icon learning-dialog-back"
                  disabled={submitting}
                  onClick={() => {
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
                  }}
                  type="button"
                >
                  ←
                </button>
              ) : null}
              <div>
                <h2 id="assignment-dialog-title">
                  {dialogView === "assign"
                    ? editTarget
                      ? "배정 수정"
                      : "단어 학습 배정"
                    : selectedStudent.displayName}
                </h2>
                <p>
                  {dialogView === "assign"
                    ? editTarget
                      ? `${selectedStudent.displayName} · 응시 시작 전`
                      : selectedStudent.displayName
                    : [selectedStudent.schoolName, selectedStudent.gradeLabel]
                        .filter(Boolean)
                        .join(" · ") || "학생 정보 미입력"}
                </p>
              </div>
            </div>
            <button
              aria-label="닫기"
              className="button button-quiet button-small"
              disabled={submitting}
              onClick={closeDialog}
              type="button"
            >
              닫기
            </button>
          </div>
          <div className="learning-dialog-body">
            {dialogView === "overview" ? (
              <section className="student-learning-overview">
                <div className="student-learning-source-row">
                  <div>
                    <span>주 단어장</span>
                    <strong>
                      {selectedStudent.currentVocabBook ?? "미선택"}
                    </strong>
                  </div>
                  <button
                    aria-label="단어 학습 배정 열기"
                    className="learning-add-button"
                    disabled={readyDatasets.length === 0}
                    onClick={() => setDialogView("assign")}
                    type="button"
                  >
                    +
                  </button>
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
                      다음 {recommendationLabel(selectedProgress)}
                    </MetaTag>
                    <MetaTag>
                      미해결 {selectedCurrentWrongCounts.wrongWordCount}개
                    </MetaTag>
                    <MetaTag>
                      다음 시험 대기 {selectedPendingReviewCount}개
                    </MetaTag>
                  </MetaTagList>
                  <HelpTip label="다음 범위 추천 이유">
                    {recommendationReasonLabel(selectedProgress)}
                  </HelpTip>
                </div>
                {readyDatasets.length === 0 ? (
                  <div className="notice notice-warm">
                    승인된 단어장이 없어 새 시험 배정은 잠겨 있습니다.
                    기존 배정과 내역은 계속 관리할 수 있습니다.
                  </div>
                ) : null}
                <div className="learning-section-heading">
                  <h3>배정 및 최근 내역</h3>
                  <span>{selectedActivities.length}개</span>
                </div>
                <StudentLearningActivityList
                  items={selectedActivities}
                  onEditAssignment={beginEdit}
                />
              </section>
            ) : (
              <>
                <div className="assignment-dialog-context">
                  <MetaTagList>
                    <MetaTag>
                      {selectedStudent.currentVocabBook ?? "단어장 미선택"}
                    </MetaTag>
                    <MetaTag tone="warning">
                      다음 {recommendationLabel(selectedProgress)}
                    </MetaTag>
                    <MetaTag>
                      오답 대기 {selectedPendingReviewCount}개
                    </MetaTag>
                  </MetaTagList>
                  <HelpTip label="다음 범위 추천 이유">
                    {recommendationReasonLabel(selectedProgress)}
                  </HelpTip>
                </div>

                {editLoading ? (
                  <div className="notice" role="status">
                    기존 배정 조건을 불러오는 중입니다.
                  </div>
                ) : null}

          <form
            aria-busy={submitting}
            className="assignment-modal-form"
            onSubmit={submitAssignment}
          >
            {success ? (
              <section
                className="assignment-success-panel"
                role="status"
              >
                <strong>{success}</strong>
                <p>
                  저장이 끝났습니다. 최신 오답 대기 수는 화면에
                  반영했습니다.
                </p>
                <button
                  className="button button-primary"
                  onClick={closeDialog}
                  type="button"
                >
                  닫기
                </button>
              </section>
            ) : (
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
                  단어 시험 배정 조건
                </legend>
            <section className="assignment-step">
              <div className="assignment-step-heading">
                <span>1</span>
                <div>
                  <h3>
                    단어장과 {unitTerm}
                    <HelpTip label={`단어장과 ${unitTerm} 도움말`}>
                      {`학생이 실제로 외울 ${unitTerm} 범위를 정합니다.`}
                    </HelpTip>
                  </h3>
                </div>
              </div>
              {exactReviewEdit ? (
                <div className="notice">
                  오답 재시험은 대상 단어를 그대로 유지합니다. 단어장·범위·문항
                  수·오답 단계는 잠겨 있고, 나머지 시험 조건만 바꿀 수 있습니다.
                </div>
              ) : null}
              <label className="field">
                <span className="field-label">단어장</span>
                <select
                  disabled={exactReviewEdit}
                  onChange={(event) =>
                    selectDataset(event.target.value)
                  }
                  required
                  value={datasetId}
                >
                  <option disabled value="">
                    단어장 선택
                  </option>
                  {datasetId &&
                  !readyDatasets.some(
                    (dataset) => dataset.id === datasetId,
                  ) ? (
                    <option disabled value={datasetId}>
                      {selectedDatasetRecord
                        ? cataloguedDatasetDisplayLabel(selectedDatasetRecord)
                        : "이전 단어장"} · 신규 배정 종료
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
                </select>
              </label>
              <div className="form-grid-2">
                <label className="field">
                  <span className="field-label">시작 {unitTerm}</span>
                  <select
                    disabled={exactReviewEdit}
                    onChange={(event) =>
                      selectStartUnit(event.target.value)
                    }
                    required
                    value={effectiveStartUnitId}
                  >
                    <option disabled value="">
                      시작 {unitTerm} 선택
                    </option>
                    {datasetUnitGroups.map((group) => (
                      <optgroup
                        key={group.group ?? "range"}
                        label={group.label ?? "범위"}
                      >
                        {group.units.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.displayName} · {unit.entryCount}개
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">끝 {unitTerm}</span>
                  <select
                    disabled={exactReviewEdit}
                    onChange={(event) => {
                      setQuestionCountMode("auto");
                      setEndUnitId(event.target.value);
                      setError("");
                      setSuccess("");
                    }}
                    required
                    value={effectiveEndUnitId}
                  >
                    <option disabled value="">
                      끝 {unitTerm} 선택
                    </option>
                    {datasetUnitGroups.map((group) => (
                      <optgroup
                        key={group.group ?? "range"}
                        label={group.label ?? "범위"}
                      >
                        {group.units.map((unit) => (
                          <option
                            disabled={
                              (datasetUnitIndex.get(unit.id) ?? -1) <
                              Math.max(startIndex, 0)
                            }
                            key={unit.id}
                            value={unit.id}
                          >
                            {unit.displayName} · {unit.entryCount}개
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              </div>
              <p className="selection-summary">
                {unitRangeLabel(selectedUnitLabels)} · 원본{" "}
                {availableWordCount.toLocaleString()}개
              </p>
              <fieldset className="assignment-review-options">
                <legend>
                  틀렸던 단어 추가
                  <HelpTip label="틀렸던 단어 추가 도움말">
                    기본은 꺼짐입니다. 학생 관리에서 다음 시험에
                    추가해 둔 미해결 단어를 함께 출제합니다. 이미 다른
                    시험에 배정 중인 단어는 자동으로 제외합니다.
                  </HelpTip>
                </legend>
                <label className="assignment-review-switch">
                  <input
                    aria-describedby="pending-review-help"
                    checked={includePendingReview}
                    disabled={
                      exactReviewEdit ||
                      (selectedAvailableReviewTotal === 0 &&
                        !includePendingReview)
                    }
                    onChange={(event) =>
                      changeIncludePendingReview(event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>틀렸던 단어 추가</strong>
                  </span>
                </label>
                <p className="field-help" id="pending-review-help">
                  현재 미해결 {selectedCurrentWrongCounts.wrongWordCount}개 ·
                  다음 시험 대기 {selectedPendingReviewCount}개 ·
                  추가 가능 {capacity?.wrongEligible ?? 0}개
                  {(capacity?.alreadyAssigned ?? 0) > 0
                    ? ` · 배정 중 ${capacity?.alreadyAssigned}개`
                    : ""}
                  {selectedReservedReviewCount > 0
                    ? ` · 이전 초안 ${selectedReservedReviewCount}개 제외`
                    : ""}
                </p>
                {includePendingReview && (
                  <div className="assignment-review-controls">
                    <div
                      aria-label="포함할 오답 단계"
                      className="filter-chip-row"
                      role="group"
                    >
                      <button
                        aria-pressed={reviewLevels.includes(1)}
                        className="filter-chip"
                        disabled={exactReviewEdit}
                        onClick={() => changeReviewLevel(1)}
                        type="button"
                      >
                        한 번 틀림 · 가능{" "}
                        {availableReviewLevel1Count}개
                      </button>
                      <button
                        aria-pressed={reviewLevels.includes(2)}
                        className="filter-chip"
                        disabled={exactReviewEdit}
                        onClick={() => changeReviewLevel(2)}
                        type="button"
                      >
                        두 번 이상 틀림 · 가능{" "}
                        {availableReviewLevel2Count}개
                      </button>
                    </div>
                    <div
                      aria-live="polite"
                      className="assignment-review-preview"
                    >
                      <small>현재 조건</small>
                      <strong>
                        틀렸던 단어 {capacity?.wrongEligible ?? 0}개 ·
                        총 {questionCount}문항
                      </strong>
                      <small>
                        선택 단계의 미해결 단어를 모두 포함합니다.
                      </small>
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
                    문제 조건
                    <HelpTip label="문제 조건 도움말">
                      방향·순서·시간과 통과 기준을 정합니다.
                    </HelpTip>
                  </h3>
                </div>
              </div>
              <div className="form-grid-2">
                <label className="field">
                  <span className="field-label">출제 방식</span>
                  <select
                    onChange={(event) => {
                      setQuestionCountMode("auto");
                      setDirectionRatio(
                        Number(event.target.value) as 0 | 50 | 100,
                      );
                      setError("");
                      setSuccess("");
                    }}
                    value={directionRatio}
                  >
                    <option value={100}>영어 → 뜻</option>
                    <option value={0}>뜻 → 영어</option>
                    <option value={50}>영어 ↔ 뜻 혼합</option>
                    <option disabled>
                      영영풀이 → 영어 · 자료 준비 필요
                    </option>
                    <option disabled>
                      예문 → 영어 · 자료 준비 필요
                    </option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">문제 순서</span>
                  <select
                    onChange={(event) =>
                      setQuestionOrderMode(
                        event.target.value as QuestionOrderMode,
                      )
                    }
                    value={questionOrderMode}
                  >
                    <option value="ascending">오름차순</option>
                    <option value="descending">내림차순</option>
                    <option value="random">무작위</option>
                  </select>
                </label>
              </div>
              <div className="form-grid-3">
                <label className="field">
                  <span className="field-label">
                    {includePendingReview ? "총 문항 수" : "문항 수"}
                  </span>
                  <input
                    max={capacity?.maximumQuestionCount ?? 500}
                    min={
                      capacity?.minimumQuestionCount ??
                      minimumAllowedQuestionCount
                    }
                    onChange={(event) => {
                      setQuestionCountMode("manual");
                      setQuestionCount(Number(event.target.value));
                      setError("");
                      setSuccess("");
                    }}
                    required
                    type="number"
                    readOnly={exactReviewEdit}
                    value={questionCount}
                  />
                  {questionCountMode === "manual" &&
                    capacity &&
                    capacity.recommendedQuestionCount !==
                      questionCount && (
                      <button
                        className="button button-quiet button-small"
                        onClick={() => {
                          setQuestionCountMode("auto");
                          setQuestionCount(
                            capacity.recommendedQuestionCount,
                          );
                        }}
                        type="button"
                      >
                        전체 {capacity.recommendedQuestionCount}개로
                        되돌리기
                      </button>
                    )}
                </label>
                <fieldset className="field timing-mode-field">
                  <legend className="field-label">
                    시간 제한 방식
                    <HelpTip label="시간 제한 방식 도움말">
                      전체 시험 시간 또는 문제당 시간 중 하나만 적용합니다.
                    </HelpTip>
                  </legend>
                  <div className="segmented-control">
                    <button
                      aria-pressed={timingMode === "total"}
                      onClick={() => setTimingMode("total")}
                      type="button"
                    >
                      전체 시험
                    </button>
                    <button
                      aria-pressed={timingMode === "per_question"}
                      onClick={() => setTimingMode("per_question")}
                      type="button"
                    >
                      문제당
                    </button>
                  </div>
                </fieldset>
                <label className="field">
                  <span className="field-label">
                    {timingMode === "total"
                      ? "전체 시험 시간(분)"
                      : "문제당 시간(초)"}
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
                  <span className="field-label">통과 점수</span>
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
              <label className="field">
                <span className="field-label">
                  응시 시작 마감 · 선택 · 한국시간
                </span>
                <input
                  onChange={(event) => {
                    setAvailableUntilLocal(event.target.value);
                    setError("");
                    setSuccess("");
                  }}
                  step={60}
                  type="datetime-local"
                  value={availableUntilLocal}
                />
                <span className="field-help">
                  이 시각까지 시험을 시작하지 않으면 미응시로
                  기록됩니다. 이미 시작한 시험은 선택한 시간 제한을
                  따릅니다.
                </span>
              </label>
            </section>

            <section className="assignment-step assignment-review-step">
              <div className="assignment-step-heading">
                <span>3</span>
                <div>
                  <h3>
                    확인하고 배정
                    <HelpTip label="시험 이름 도움말">
                      시험 이름은 자동 생성하며 필요할 때만 바꿉니다.
                    </HelpTip>
                  </h3>
                </div>
              </div>
              <label className="field">
                <span className="field-label">
                  시험 이름 변경 · 선택
                </span>
                <input
                  maxLength={160}
                  onChange={(event) => {
                    setCustomTitle(event.target.value);
                    setError("");
                    setSuccess("");
                  }}
                  placeholder={generatedTitle || "자동 시험 이름"}
                  value={customTitle}
                />
              </label>
              <div className="assignment-review-summary">
                <strong>
                  {finalTitle || "시험 범위를 선택해주세요."}
                </strong>
                <dl>
                  <div>
                    <dt>학생</dt>
                    <dd>{selectedStudent.displayName}</dd>
                  </div>
                  <div>
                    <dt>범위</dt>
                    <dd>{unitRangeLabel(selectedUnitLabels)}</dd>
                  </div>
                  <div>
                    <dt>출제</dt>
                    <dd>{directionLabel(directionRatio)}</dd>
                  </div>
                  <div>
                    <dt>순서</dt>
                    <dd>
                      {questionOrderLabel(questionOrderMode)}
                    </dd>
                  </div>
                  <div>
                    <dt>구성</dt>
                    <dd>
                      {includePendingReview
                        ? `${unitTerm} + 틀렸던 단어 ${capacity?.wrongEligible ?? 0}개`
                        : unitTerm}
                    </dd>
                  </div>
                  <div>
                    <dt>조건</dt>
                    <dd>
                      총 {questionCount}문항 ·{" "}
                      {timingMode === "total"
                        ? `전체 ${timeLimitMinutes}분`
                        : `문제당 ${questionTimeLimitSeconds}초`}{" "}
                      ·{" "}
                      {passingScore}점
                    </dd>
                  </div>
                  <div>
                    <dt>응시 시작 마감</dt>
                    <dd>
                      {availableUntilLocal
                        ? `${availableUntilLocal.replace("T", " ")} · 한국시간`
                        : "마감 없음"}
                    </dd>
                  </div>
                </dl>
              </div>
              {editDraft ? (
                <section
                  aria-label="배정 변경 비교"
                  className="assignment-edit-comparison"
                >
                  <div className="assignment-edit-comparison-heading">
                    <strong>변경 전·후</strong>
                    <span>{editComparisons.length}개 변경</span>
                  </div>
                  {editComparisons.length > 0 ? (
                    <dl>
                      {editComparisons.map((comparison) => (
                        <div key={comparison.key}>
                          <dt>{comparison.label}</dt>
                          <dd>
                            <span>
                              <span className="sr-only">변경 전: </span>
                              {comparison.before}
                            </span>
                            <span aria-hidden="true">→</span>
                            <strong>
                              <span className="sr-only">변경 후: </span>
                              {comparison.after}
                            </strong>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p>아직 바뀐 조건이 없습니다.</p>
                  )}
                  {editRebuildsQuestions ? (
                    <p className="field-help">
                      범위·문항 구성 변경으로 문제와 선택지를 다시 구성합니다.
                    </p>
                  ) : null}
                </section>
              ) : null}
              {!success && capacityLoading && (
                <div className="notice" role="status">
                  실제 출제 가능한 문항 수를 계산하는 중입니다.
                </div>
              )}
              {!success && capacityError && (
                <div className="notice notice-error" role="alert">
                  {capacityError}
                </div>
              )}
              {!success && capacity && (
                <div className="notice" role="status">
                  단원 후보 {capacity.unitEligible}개
                  {includePendingReview
                    ? ` + 틀렸던 단어 ${capacity.wrongEligible}개 - 중복 ${capacity.overlap}개`
                    : ""}
                  {" · "}실제 출제 가능 최대{" "}
                  {capacity.maximumQuestionCount}문항
                </div>
              )}
              {!success &&
                includePendingReview &&
                capacity &&
                capacity.wrongEligible === 0 && (
                  <div className="notice notice-error" role="alert">
                    선택한 단계에 추가 가능한 틀렸던 단어가 없습니다.
                  </div>
                )}
              {!success &&
                capacity &&
                (questionCount < capacity.minimumQuestionCount ||
                  questionCount > capacity.maximumQuestionCount) && (
                  <div className="notice notice-error" role="alert">
                    현재 조건에서는 {capacity.minimumQuestionCount}~
                    {capacity.maximumQuestionCount}문항으로 배정할 수
                    있습니다.
                  </div>
                )}
              {!success &&
                (questionCount < minimumAllowedQuestionCount ||
                  questionCount > 500) && (
                  <div className="notice notice-error" role="alert">
                  총 문항 수는 {minimumAllowedQuestionCount}개 이상
                  500개 이하여야 합니다.
                </div>
              )}
              {!success &&
                timingMode === "total" &&
                (timeLimitSeconds < 30 ||
                  timeLimitSeconds > 10800) && (
                <div className="notice notice-error" role="alert">
                  전체 시험 시간은 30초 이상 180분 이하여야
                  합니다.
                </div>
              )}
              {!success &&
                timingMode === "per_question" &&
                (questionTimeLimitSeconds < 5 ||
                  questionTimeLimitSeconds > 600) && (
                  <div className="notice notice-error" role="alert">
                    문제당 시간은 5초 이상 600초 이하여야 합니다.
                  </div>
                )}
              {error && (
                <div className="notice notice-error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="button button-primary button-large"
                disabled={cannotCreate}
                type="submit"
              >
                {submitting
                  ? editTarget
                    ? "수정하는 중…"
                    : "배정하는 중…"
                  : refreshPending
                    ? "화면에 반영하는 중…"
                    : editTarget
                      ? editComparisons.length > 0
                        ? "변경 내용 저장"
                        : "변경 없음"
                      : includePendingReview
                      ? "틀렸던 단어 포함해 배정"
                      : "이 학생에게 배정"}
              </button>
            </section>
              </fieldset>
            )}
          </form>
              </>
            )}
          </div>
        </dialog>
      )}
    </>
  );
}
