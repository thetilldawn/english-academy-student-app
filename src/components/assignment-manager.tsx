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
import {
  currentTimeMilliseconds,
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

type DatasetItem = {
  id: string;
  title: string;
  edition: string | null;
  rowCount: number;
  status: "pending_review" | "ready" | "retired";
  isActive: boolean;
};

type StudentItem = {
  id: string;
  displayName: string;
  schoolName: string | null;
  gradeLabel: string | null;
  currentVocabBook: string | null;
  currentVocabDatasetId: string | null;
  status: "active" | "blocked";
};

type UnitItem = {
  id: string;
  datasetId: string;
  label: string;
  kind: "day" | "supplement";
  number: number | null;
  sortIndex: number;
  entryCount: number;
};

type ProgressItem = {
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
  latestScore: number | null;
  latestInitialScore: number | null;
  latestFinalScore: number | null;
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

type WrongWordStudentFilter = "all" | "wrong" | "repeated";

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

function statusLabel(status: ProgressItem["latestStatus"]) {
  if (status === "not_started") return "응시 전";
  if (status === "cancelled") return "배정 취소";
  if (status === "missed") return "미응시 마감";
  if (status === "in_progress") return "응시 중";
  if (status === "completed") return "완료";
  if (status === "expired") return "시간 종료";
  return "시험 기록 없음";
}

function scoreLabel(score: number | null | undefined) {
  return score === null || score === undefined ? "-" : `${score}점`;
}

function recommendationLabel(progress: ProgressItem | null) {
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

function recommendationReasonLabel(progress: ProgressItem | null) {
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
  initialStudentId = "",
}: {
  datasets: DatasetItem[];
  students: StudentItem[];
  units: UnitItem[];
  progress: ProgressItem[];
  pendingReviewSummaries: StudentPendingReviewSummary[];
  currentVocabWrongSummaries: StudentCurrentVocabWrongSummary[];
  initialStudentId?: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestInFlightRef = useRef(false);
  const readyDatasets = useMemo(
    () =>
      datasets.filter(
        (dataset) => dataset.status === "ready" && dataset.isActive,
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
  const initialStudent =
    activeStudents.find((student) => student.id === initialStudentId) ??
    null;
  const initialStudentDatasetId = readyDatasets.some(
    (dataset) => dataset.id === initialStudent?.currentVocabDatasetId,
  )
    ? initialStudent?.currentVocabDatasetId
    : null;
  const initialDatasetId =
    initialStudentDatasetId ?? readyDatasets[0]?.id ?? "";
  const initialProgress = initialStudent
    ? (progressByStudent.get(initialStudent.id) ?? null)
    : null;
  const initialRecommendedUnitId =
    initialProgress?.recommendedDatasetId === initialDatasetId
      ? (initialProgress.recommendedUnitId ?? "")
      : "";

  const [testTab, setTestTab] = useState<"vocab" | "other">("vocab");
  const [query, setQuery] = useState("");
  const [schoolFilter, setSchoolFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [wrongWordFilter, setWrongWordFilter] =
    useState<WrongWordStudentFilter>("all");
  const [studentId, setStudentId] = useState(initialStudent?.id ?? "");
  const [datasetId, setDatasetId] = useState(initialDatasetId);
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
  const selectedUnitLabels = selectedUnits.map((unit) => unit.label);
  const selectedUnitIdsKey = selectedUnits
    .map((unit) => unit.id)
    .join(",");
  const reviewLevelsKey = reviewLevels.join(",");
  const generatedTitle = [
    selectedDataset?.title,
    selectedDataset?.edition,
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
  const capacityInvalid =
    !capacity ||
    capacity.maximumQuestionCount < 4 ||
    questionCount < capacity.minimumQuestionCount ||
    questionCount > capacity.maximumQuestionCount ||
    (includePendingReview && capacity.wrongEligible < 1);
  const cannotCreate =
    !studentId ||
    !datasetId ||
    !selectedDataset ||
    selectedUnits.length === 0 ||
    questionCount < 4 ||
    questionCount > 500 ||
    capacityInvalid ||
    capacityLoading ||
    Boolean(capacityError) ||
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
  const filteredStudents = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("ko-KR");
    return activeStudents.filter((student) => {
      const searchText = [
        student.displayName,
        student.schoolName,
        student.gradeLabel,
        student.currentVocabBook,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ko-KR");
      return (
        (!keyword || searchText.includes(keyword)) &&
        (!schoolFilter || student.schoolName === schoolFilter) &&
        (!gradeFilter || student.gradeLabel === gradeFilter) &&
        (() => {
          if (wrongWordFilter === "all") return true;
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
    });
  }, [
    activeStudents,
    currentVocabWrongIndex,
    gradeFilter,
    query,
    schoolFilter,
    wrongWordFilter,
  ]);

  useEffect(() => {
    if (selectedStudent && !dialogRef.current?.open) {
      dialogRef.current?.showModal();
    }
  }, [selectedStudent]);

  useEffect(() => {
    if (!studentId || !datasetId || !selectedUnitIdsKey) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setCapacityLoading(true);
      setCapacityError("");
      void fetch("/api/admin/assignment-capacity", {
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

  function selectStudent(nextStudentId: string) {
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
    resetScopedControls();
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
    resetScopedControls();
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
        title: customTitle,
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
      const response = await fetch(submission.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submission.body),
      });
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
        includePendingReview
          ? `${selectedStudent?.displayName ?? "학생"}에게 틀렸던 단어를 포함해 배정했습니다.`
          : `${selectedStudent?.displayName ?? "학생"}에게 배정했습니다.`,
      );
      setAvailableUntilLocal("");
      setCustomTitle("");
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
          단어 시험
        </button>
        <button
          aria-pressed={testTab === "other"}
          className="management-tab"
          onClick={() => setTestTab("other")}
          type="button"
        >
          다른 시험
        </button>
      </div>

      {testTab === "other" ? (
        <section className="empty-state test-type-placeholder">
          다른 유형의 시험은 워크북 문제 구조가 확정되면 이 탭에
          추가합니다.
        </section>
      ) : (
        <section className="assignment-student-browser">
          <div className="manager-toolbar">
            <div>
              <h2 className="assignment-list-heading">
                학생 선택
              </h2>
              <p className="list-meta">
                학생을 찾은 뒤 최근 범위와 다음 DAY를 확인하고
                배정합니다.
              </p>
            </div>
            <span className="detail-chip">
              {filteredStudents.length}명
            </span>
          </div>

          <div className="card assignment-student-filters">
            <label className="field assignment-search-field">
              <span className="field-label">학생 검색</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="이름·학교·학년·단어장"
                type="search"
                value={query}
              />
            </label>
            <label className="field">
              <span className="field-label">학교</span>
              <select
                onChange={(event) => setSchoolFilter(event.target.value)}
                value={schoolFilter}
              >
                <option value="">전체 학교</option>
                {schoolOptions.map((school) => (
                  <option key={school} value={school}>
                    {school}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">학년</span>
              <select
                onChange={(event) => setGradeFilter(event.target.value)}
                value={gradeFilter}
              >
                <option value="">전체 학년</option>
                {gradeOptions.map((grade) => (
                  <option key={grade} value={grade}>
                    {grade}
                  </option>
                ))}
              </select>
            </label>
            <div
              aria-label="현재 단어장 오답 이력 필터"
              className="filter-chip-row assignment-review-filter-row"
              role="group"
            >
              {(
                [
                  ["all", "전체"],
                  ["wrong", "현재 단어장 오답 있음"],
                  ["repeated", "두 번 이상 틀린 단어 있음"],
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
                return (
                  <button
                    className="card assignment-student-row"
                    key={student.id}
                    onClick={() => selectStudent(student.id)}
                    type="button"
                  >
                    <span className="assignment-student-identity">
                      <strong>{student.displayName}</strong>
                      <span>
                        {[student.schoolName, student.gradeLabel]
                          .filter(Boolean)
                          .join(" · ") || "학교·학년 미입력"}
                      </span>
                    </span>
                    <span className="assignment-student-book">
                      <small>현재 단어장</small>
                      <strong>
                        {student.currentVocabBook ?? "미선택"}
                      </strong>
                      <span className="assignment-student-review-summary">
                        오답 대기 {studentPendingReviewCount}개 · 혼합
                        가능 {studentAvailableReviewCount}개
                      </span>
                    </span>
                    <span className="assignment-student-recent">
                      <small>최근 배정·진행</small>
                      <strong>
                        {studentProgress?.latestAssignmentTitle ??
                          "기록 없음"}
                      </strong>
                      <span>
                        {statusLabel(
                          studentProgress?.latestStatus ?? null,
                        )}
                        {" · "}첫{" "}
                        {scoreLabel(
                          studentProgress?.latestInitialScore,
                        )}
                        {" · "}최종{" "}
                        {scoreLabel(
                          studentProgress?.latestFinalScore,
                        )}
                      </span>
                      <small>
                        최근 완료 ·{" "}
                        {studentProgress?.latestCompletedAssignmentTitle ??
                          "기록 없음"}
                        {studentProgress?.latestCompletedAssignmentTitle
                          ? ` · 최종 ${scoreLabel(
                              studentProgress.latestCompletedFinalScore,
                            )}`
                          : ""}
                      </small>
                    </span>
                    <span className="assignment-student-next">
                      <small>다음 배정</small>
                      <strong>
                        {recommendationLabel(studentProgress)}
                      </strong>
                      <span>
                        {recommendationReasonLabel(studentProgress)}
                      </span>
                    </span>
                    <span className="button button-primary button-small">
                      배정
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {selectedStudent && (
        <dialog
          aria-labelledby="assignment-dialog-title"
          className="dialog dialog-extra-wide assignment-dialog"
          onCancel={handleDialogCancel}
          onClick={closeDialogOnBackdrop}
          onClose={handleDialogClose}
          ref={dialogRef}
        >
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">단어 시험 배정</p>
              <h2 id="assignment-dialog-title">
                {selectedStudent.displayName}
              </h2>
              <p>
                {[
                  selectedStudent.schoolName,
                  selectedStudent.gradeLabel,
                  selectedStudent.currentVocabBook,
                ]
                  .filter(Boolean)
                  .join(" · ") || "학생 정보 미입력"}
              </p>
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

          <div className="assignment-dialog-context">
            <span>
              최근 시험 ·{" "}
              {selectedProgress?.latestAssignmentTitle ?? "기록 없음"}
            </span>
            <span>
              {statusLabel(selectedProgress?.latestStatus ?? null)}
              {" · "}첫{" "}
              {scoreLabel(selectedProgress?.latestInitialScore)}
              {" · "}최종{" "}
              {scoreLabel(selectedProgress?.latestFinalScore)}
            </span>
            <strong>
              추천 · {recommendationLabel(selectedProgress)}
            </strong>
            <span>
              추천 이유 · {recommendationReasonLabel(selectedProgress)}
            </span>
            <span>
              최근 완료 ·{" "}
              {selectedProgress?.latestCompletedAssignmentTitle ??
                "기록 없음"}
              {selectedProgress?.latestCompletedAssignmentTitle
                ? ` · 최종 ${scoreLabel(
                    selectedProgress.latestCompletedFinalScore,
                  )}`
                : ""}
            </span>
            <span>
              틀렸던 단어 대기 · 한 번 {selectedReviewCounts.pendingLevel1Count}
              개 · 두 번 이상{" "}
              {selectedReviewCounts.pendingLevel2Count}개
            </span>
            <span>
              추가 가능 {selectedAvailableReviewTotal}개 · 이전 초안
              {selectedReservedReviewCount}개
            </span>
          </div>

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
                disabled={submitting || refreshPending}
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
              <label className="field">
                <span className="field-label">단어장</span>
                <select
                  onChange={(event) =>
                    selectDataset(event.target.value)
                  }
                  required
                  value={datasetId}
                >
                  <option disabled value="">
                    단어장 선택
                  </option>
                  {readyDatasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {[dataset.title, dataset.edition]
                        .filter(Boolean)
                        .join(" · ")}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-grid-2">
                <label className="field">
                  <span className="field-label">시작 {unitTerm}</span>
                  <select
                    onChange={(event) =>
                      selectStartUnit(event.target.value)
                    }
                    required
                    value={effectiveStartUnitId}
                  >
                    <option disabled value="">
                      시작 {unitTerm} 선택
                    </option>
                    {datasetUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.label} · {unit.entryCount}개
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">끝 {unitTerm}</span>
                  <select
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
                    {datasetUnits.map((unit, index) => (
                      <option
                        disabled={index < Math.max(startIndex, 0)}
                        key={unit.id}
                        value={unit.id}
                      >
                        {unit.label} · {unit.entryCount}개
                      </option>
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
                      selectedAvailableReviewTotal === 0 &&
                      !includePendingReview
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
                        onClick={() => changeReviewLevel(1)}
                        type="button"
                      >
                        한 번 틀림 · 가능{" "}
                        {availableReviewLevel1Count}개
                      </button>
                      <button
                        aria-pressed={reviewLevels.includes(2)}
                        className="filter-chip"
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
                    min={capacity?.minimumQuestionCount ?? 4}
                    onChange={(event) => {
                      setQuestionCountMode("manual");
                      setQuestionCount(Number(event.target.value));
                      setError("");
                      setSuccess("");
                    }}
                    required
                    type="number"
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
                      min={1}
                      onChange={(event) =>
                        setTimeLimitMinutes(Number(event.target.value))
                      }
                      required
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
                (questionCount < 4 || questionCount > 500) && (
                <div className="notice notice-error" role="alert">
                  총 문항 수는 4개 이상 500개 이하여야 합니다.
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
                  ? "배정하는 중…"
                  : refreshPending
                    ? "화면에 반영하는 중…"
                    : includePendingReview
                      ? "틀렸던 단어 포함해 배정"
                      : "이 학생에게 배정"}
              </button>
            </section>
              </fieldset>
            )}
          </form>
        </dialog>
      )}
    </>
  );
}
