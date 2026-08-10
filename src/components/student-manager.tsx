"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  assignmentDisplayTitle,
  type AssignmentHistorySummary,
} from "@/lib/admin/history";
import { buildStudentAccessUrl } from "@/lib/auth/student-code-input";
import type { StudentWrongWordHistory } from "@/lib/admin/wrong-word-history";
import { sendKakaoText } from "@/lib/kakao-share";
import { StudentWrongWordPanel } from "@/components/student-wrong-word-panel";
import { StudentLearningActivityList } from "@/components/student-learning-activity-list";
import { StudentLearningSourceList } from "@/components/student-learning-source-list";
import { StudentVocabBookHistoryList } from "@/components/student-vocab-book-history-list";
import { HelpTip } from "@/components/help-tip";
import { ActivityStatusTimeline } from "@/components/activity-status-timeline";
import {
  CountBadge,
  MetaTag,
  MetaTagList,
  StatusBadge,
} from "@/design-system/primitives/badge/badge";
import { adminLearningText } from "@/content/ko/admin-learning";
import { adminStudentsText } from "@/content/ko/admin-students";
import { commonText } from "@/content/ko/common";
import { formatContentText } from "@/content/format";
import {
  AssignmentManager,
  type AssignmentDatasetItem,
  type AssignmentUnitItem,
} from "@/components/assignment-manager";
import { AttemptScoreSummary } from "@/components/attempt-score-summary";
import {
  Button,
  IconButton,
  buttonRecipe,
} from "@/design-system/primitives/button/button";
import { Tabs } from "@/components/ui-tabs";
import { ModalBody, ModalFrame, ModalHeader } from "@/components/ui-modal";
import { buildAttemptStatusPresentation } from "@/lib/ui/attempt-score-presentation";
import {
  cataloguedDatasetDisplayLabel,
  groupCataloguedDatasets,
  type CataloguedDataset,
} from "@/lib/admin/dataset-catalog";
import {
  activityNeedsRetry,
  compareLearningActivities,
  studentLearningActivityIndex,
} from "@/lib/admin/learning-activity";
import type { StudentPendingReviewSummary } from "@/lib/admin/review-queue-summary";
import {
  currentVocabWrongSummaryKey,
  emptyCurrentVocabWrongCounts,
  indexStudentCurrentVocabWrongSummaries,
  type StudentCurrentVocabWrongSummary,
} from "@/lib/admin/wrong-history-summary";
import {
  learningSourceLabelsForStudent,
  learningSourceTypeLabel,
  type StudentLearningSourceItem,
} from "@/lib/admin/learning-sources";
import type { StudentVocabBookHistory } from "@/lib/admin/student-vocab-book-history";
import type { ReadingCurriculumStage } from "@/lib/admin/reading-curriculum";
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

type StudentItem = {
  id: string;
  displayName: string;
  schoolName: string | null;
  gradeLabel: string | null;
  currentVocabBook: string | null;
  currentVocabDatasetId: string | null;
  readingCurriculumStage: ReadingCurriculumStage;
  readingContextSyncStatus:
    | "not_synced"
    | "not_configured"
    | "synced"
    | "failed";
  status: "active" | "blocked";
  codeGeneration: number;
  codeStatus: "active" | "blocked" | "expired" | "missing";
};

type DatasetOption = CataloguedDataset;

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
    | "first"
    | "assigned"
    | "next"
    | "repeat"
    | "resume"
    | "complete"
    | "manual"
    | null;
};

type ApiResponse = {
  code?: string;
  error?: string;
};

type WrongHistoryCacheEntry = {
  history: StudentWrongWordHistory;
  loadedAt: number;
};

type WrongWordStudentFilter = "all" | "wrong" | "repeated" | "retry";

function StudentVocabularyAssignmentAction({
  disabled,
  onAssign,
}: {
  disabled: boolean;
  onAssign: () => void;
}) {
  return (
    <div className="student-inline-assignment-action">
      <strong className="label-with-help">
        {adminStudentsText.learning.nextVocabularyTitle}
        <HelpTip label={adminStudentsText.learning.nextVocabularyHelpAria}>
          {adminStudentsText.learning.nextVocabularyHelp}
        </HelpTip>
      </strong>
      <Button disabled={disabled} onClick={onAssign} variant="primary">
        {adminStudentsText.learning.assign}
      </Button>
    </div>
  );
}

function studentRecommendationLabel(
  progress: ProgressItem | null | undefined,
) {
  if (progress?.recommendationReason === "complete") {
    return adminStudentsText.recommendation.complete;
  }
  if (progress?.recommendationReason === "manual") {
    return adminStudentsText.recommendation.manual;
  }
  return (
    progress?.recommendedUnitLabel ??
    adminStudentsText.recommendation.needsWordbook
  );
}

function StudentCodeContent({
  code,
  copied,
  onCopy,
  onShare,
}: {
  code: string;
  copied: boolean;
  onCopy: () => void;
  onShare: () => void;
}) {
  return (
    <>
      <div className="dialog-code">{code}</div>
      <div className="student-code-actions">
        <Button autoFocus onClick={onShare} variant="primary">
          {adminStudentsText.codeModal.sendKakao}
        </Button>
        <Button onClick={onCopy}>
          {copied
            ? adminStudentsText.codeModal.copied
            : adminStudentsText.codeModal.copy}
        </Button>
      </div>
    </>
  );
}

export function StudentManager({
  appOrigin,
  assignmentDatasets,
  assignmentUnits,
  currentVocabWrongSummaries,
  datasets,
  currentHistory,
  history,
  initialStudentId = "",
  launcherOnly = false,
  learningSources,
  onLauncherClose,
  pendingReviewSummaries,
  progress,
  students,
  vocabBookHistory,
}: {
  appOrigin: string;
  assignmentDatasets: AssignmentDatasetItem[];
  assignmentUnits: AssignmentUnitItem[];
  currentVocabWrongSummaries: StudentCurrentVocabWrongSummary[];
  datasets: DatasetOption[];
  currentHistory: AssignmentHistorySummary[];
  history: AssignmentHistorySummary[];
  initialStudentId?: string;
  launcherOnly?: boolean;
  learningSources: StudentLearningSourceItem[];
  onLauncherClose?: () => void;
  pendingReviewSummaries: StudentPendingReviewSummary[];
  progress: ProgressItem[];
  students: StudentItem[];
  vocabBookHistory: StudentVocabBookHistory[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [createError, setCreateError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [refreshPending, startRefreshTransition] = useTransition();
  const [shownCode, setShownCode] = useState<{
    code: string;
    label: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const initialStudent =
    students.find((student) => student.id === initialStudentId) ?? null;
  const [selectedStudentId, setSelectedStudentId] = useState(
    initialStudent?.id ?? "",
  );
  const [activeTab, setActiveTab] = useState<
    "learning" | "account" | "history"
  >("learning");
  const [learningView, setLearningView] = useState<
    "summary" | "vocab" | "passage"
  >("summary");
  const [learningSourceDatasetId, setLearningSourceDatasetId] = useState("");
  const [learningSourceLabel, setLearningSourceLabel] = useState("");
  const [assignmentDatasetId, setAssignmentDatasetId] = useState("");
  const [assignmentStudentId, setAssignmentStudentId] = useState("");
  const [assignmentEditTarget, setAssignmentEditTarget] = useState<{
    assignmentId: string;
    studentId: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [schoolFilter, setSchoolFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [wordbookFilter, setWordbookFilter] = useState("");
  const [wrongWordFilter, setWrongWordFilter] =
    useState<WrongWordStudentFilter>("all");
  const [wrongHistoryByStudent, setWrongHistoryByStudent] = useState<
    Record<string, WrongHistoryCacheEntry>
  >({});
  const selectedStudent =
    students.find((student) => student.id === selectedStudentId) ?? null;
  const [profileDatasetId, setProfileDatasetId] = useState(
    selectedStudent?.currentVocabDatasetId ?? "",
  );
  const [profileDisplayName, setProfileDisplayName] = useState(
    selectedStudent?.displayName ?? "",
  );
  const [profileSchoolName, setProfileSchoolName] = useState(
    selectedStudent?.schoolName ?? "",
  );
  const [profileGradeLabel, setProfileGradeLabel] = useState(
    selectedStudent?.gradeLabel ?? "",
  );
  const studentDialogRef = useRef<HTMLDialogElement>(null);
  const codeDialogRef = useRef<HTMLDialogElement>(null);
  const copyResetTimerRef = useRef<number | null>(null);
  const interactionBusy = busyKey !== "" || refreshPending;
  const datasetGroups = useMemo(
    () => groupCataloguedDatasets(datasets),
    [datasets],
  );

  useEffect(() => {
    if (
      shownCode &&
      !selectedStudent &&
      codeDialogRef.current &&
      !codeDialogRef.current.open
    ) {
      codeDialogRef.current.showModal();
    }
  }, [selectedStudent, shownCode]);

  useEffect(
    () => () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (
      selectedStudent &&
      studentDialogRef.current &&
      !studentDialogRef.current.open
    ) {
      studentDialogRef.current.showModal();
    }
  }, [selectedStudent]);

  function openCodeDialog(code: string, label: string) {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
    setCopied(false);
    setShownCode({ code, label });
  }

  function closeCodeDialog() {
    codeDialogRef.current?.close();
  }

  function closeCodeDialogOnBackdrop(
    event: MouseEvent<HTMLDialogElement>,
  ) {
    if (event.target === event.currentTarget) closeCodeDialog();
  }

  function openStudentAssignment(input: {
    datasetId: string;
    studentId: string;
    editTarget: {
      assignmentId: string;
      studentId: string;
    } | null;
  }) {
    setAssignmentDatasetId(input.datasetId);
    setAssignmentEditTarget(input.editTarget);
    setAssignmentStudentId(input.studentId);
  }

  function finishClosingCodeDialog() {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
    setCopied(false);
    setShownCode(null);
  }

  function selectStudent(
    student: StudentItem,
    tab: "learning" | "account" | "history" = "learning",
  ) {
    setSelectedStudentId(student.id);
    setActiveTab(tab);
    setLearningView("summary");
    setLearningSourceDatasetId(student.currentVocabDatasetId ?? "");
    setLearningSourceLabel(student.currentVocabBook ?? "");
    setProfileDatasetId(student.currentVocabDatasetId ?? "");
    setProfileDisplayName(student.displayName);
    setProfileSchoolName(student.schoolName ?? "");
    setProfileGradeLabel(student.gradeLabel ?? "");
  }

  const cacheWrongWordHistory = useCallback(
    (studentId: string, history: StudentWrongWordHistory) => {
      setWrongHistoryByStudent((current) => ({
        ...current,
        [studentId]: {
          history,
          loadedAt: Date.now(),
        },
      }));
    },
    [],
  );

  function beginAction(key: string) {
    if (interactionBusy) {
      return false;
    }

    setError("");
    setBusyKey(key);
    return true;
  }

  function finishAction() {
    setBusyKey("");
  }

  async function request(
    url: string,
    options?: RequestInit,
  ): Promise<ApiResponse> {
    const response = await fetch(url, options);
    let payload: ApiResponse = {};
    try {
      payload = (await response.json()) as ApiResponse;
    } catch {
      // 프록시 오류처럼 JSON이 아닌 응답은 아래의 안전한 기본 문구로 처리한다.
    }
    if (!response.ok) {
      throw new Error(
        payload.error ?? adminStudentsText.codeModal.genericRequestError,
      );
    }
    return payload;
  }

  async function createStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!beginAction("create")) {
      return;
    }
    setCreateError("");

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    try {
      const payload = await request("/api/admin/students", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: form.get("displayName"),
          schoolName: form.get("schoolName"),
          gradeLabel: form.get("gradeLabel"),
          currentVocabDatasetId: form.get("currentVocabDatasetId"),
          note: form.get("note"),
        }),
      });
      if (!payload.code) {
        throw new Error(adminStudentsText.createStudent.noCodeError);
      }
      openCodeDialog(
        payload.code,
        formatContentText(adminStudentsText.createStudent.codeTitle, {
          student: String(form.get("displayName")),
        }),
      );
      toast.success(adminStudentsText.createStudent.success);
      formElement.reset();
      startRefreshTransition(() => router.refresh());
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.createStudent.error;
      setCreateError(message);
      toast.error(message);
    } finally {
      finishAction();
    }
  }

  async function saveCurrentDataset() {
    if (
      !selectedStudent ||
      !beginAction(`vocab:${selectedStudent.id}`)
    ) {
      return;
    }

    try {
      await request(
        `/api/admin/students/${selectedStudent.id}/vocab`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            currentVocabDatasetId: profileDatasetId,
          }),
        },
      );
      toast.success(adminStudentsText.account.wordbookSuccess);
      startRefreshTransition(() => router.refresh());
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.account.wordbookError,
      );
    } finally {
      finishAction();
    }
  }

  async function saveStudentProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedStudent ||
      !profileDisplayName.trim() ||
      !beginAction(`profile:${selectedStudent.id}`)
    ) {
      return;
    }

    try {
      await request(`/api/admin/students/${selectedStudent.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: profileDisplayName,
          schoolName: profileSchoolName,
          gradeLabel: profileGradeLabel,
        }),
      });
      toast.success(adminStudentsText.account.profileSuccess);
      startRefreshTransition(() => router.refresh());
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.account.profileError,
      );
    } finally {
      finishAction();
    }
  }

  async function reveal(student: StudentItem) {
    if (!beginAction(`reveal:${student.id}`)) {
      return;
    }

    try {
      const payload = await request(
        `/api/admin/students/${student.id}/code`,
      );
      if (!payload.code) {
        throw new Error(adminStudentsText.codeModal.missingCodeError);
      }
      if (!studentDialogRef.current?.open) return;
      openCodeDialog(
        payload.code,
        formatContentText(adminStudentsText.codeModal.revealTitle, {
          student: student.displayName,
        }),
      );
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.codeModal.revealError,
      );
    } finally {
      finishAction();
    }
  }

  async function rotate(student: StudentItem) {
    const accepted = window.confirm(
      formatContentText(adminStudentsText.account.rotateConfirm, {
        student: student.displayName,
      }),
    );
    if (!accepted) return;

    if (!beginAction(`rotate:${student.id}`)) {
      return;
    }

    try {
      const payload = await request(
        `/api/admin/students/${student.id}/code/rotate`,
        { method: "POST" },
      );
      if (!payload.code) {
        throw new Error(adminStudentsText.createStudent.noCodeError);
      }
      if (!studentDialogRef.current?.open) return;
      openCodeDialog(
        payload.code,
        formatContentText(adminStudentsText.codeModal.rotateTitle, {
          student: student.displayName,
        }),
      );
      toast.success(adminStudentsText.account.rotateSuccess);
      startRefreshTransition(() => router.refresh());
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.account.rotateError,
      );
    } finally {
      finishAction();
    }
  }

  async function block(student: StudentItem) {
    const accepted = window.confirm(
      formatContentText(adminStudentsText.account.blockConfirm, {
        student: student.displayName,
      }),
    );
    if (!accepted) return;

    if (!beginAction(`block:${student.id}`)) {
      return;
    }

    try {
      await request(`/api/admin/students/${student.id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "blocked" }),
      });
      toast.success(adminStudentsText.account.blockSuccess);
      startRefreshTransition(() => router.refresh());
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.account.blockError,
      );
    } finally {
      finishAction();
    }
  }

  async function deleteSelectedStudent() {
    if (!selectedStudent) return;
    const accepted = window.confirm(
      formatContentText(adminStudentsText.account.deleteConfirm, {
        student: selectedStudent.displayName,
      }),
    );
    if (
      !accepted ||
      !beginAction(`delete:${selectedStudent.id}`)
    ) {
      return;
    }

    try {
      await request(`/api/admin/students/${selectedStudent.id}`, {
        method: "DELETE",
      });
      closeStudentDialog();
      setSelectedStudentId("");
      toast.success(adminStudentsText.account.deleteSuccess);
      startRefreshTransition(() => router.refresh());
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.account.deleteError,
      );
    } finally {
      finishAction();
    }
  }

  async function copyCode() {
    if (!shownCode) return;
    try {
      await navigator.clipboard.writeText(shownCode.code);
      setCopied(true);
      toast.success(adminStudentsText.codeModal.copySuccess);
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyResetTimerRef.current = null;
      }, 1500);
    } catch {
      toast.error(adminStudentsText.codeModal.copyFailure);
    }
  }

  async function shareCode() {
    if (!shownCode) return;
    const studentAccessUrl = buildStudentAccessUrl(
      appOrigin,
      shownCode.code,
    );
    const message = [
      shownCode.label,
      formatContentText(adminStudentsText.codeModal.addressLine, {
        url: studentAccessUrl,
      }),
      formatContentText(adminStudentsText.codeModal.codeLine, {
        code: shownCode.code,
      }),
    ].join("\n");

    try {
      const result = await sendKakaoText({
        title: shownCode.label,
        message,
        url: studentAccessUrl,
      });
      if (result === "sent") {
        toast.success(adminStudentsText.codeModal.kakaoOpened);
        return;
      }
      await navigator.clipboard.writeText(message);
      toast.success(
        result === "unconfigured"
          ? adminStudentsText.codeModal.kakaoFallbackUnconfigured
          : adminStudentsText.codeModal.kakaoFallbackFailed,
      );
    } catch {
      toast.error(adminStudentsText.codeModal.kakaoFallbackCopyFailure);
    }
  }

  const activitiesByStudent = useMemo(
    () => studentLearningActivityIndex(currentHistory),
    [currentHistory],
  );
  const currentVocabWrongIndex = useMemo(
    () =>
      indexStudentCurrentVocabWrongSummaries(
        currentVocabWrongSummaries,
      ),
    [currentVocabWrongSummaries],
  );
  const learningSourcesByStudent = useMemo(() => {
    const index = new Map<string, StudentLearningSourceItem[]>();
    for (const source of learningSources) {
      const current = index.get(source.studentId) ?? [];
      current.push(source);
      index.set(source.studentId, current);
    }
    return index;
  }, [learningSources]);
  const schoolOptions = useMemo(
    () =>
      Array.from(
        new Set(
          students
            .map((student) => student.schoolName?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).toSorted(),
    [students],
  );
  const gradeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          students
            .map((student) => student.gradeLabel?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).toSorted(),
    [students],
  );
  const wordbookOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...students.map((student) => student.currentVocabBook?.trim()),
            ...learningSources.map((source) => source.displayLabel.trim()),
          ]
            .filter((value): value is string => Boolean(value)),
        ),
      ).toSorted(),
    [learningSources, students],
  );
  const filteredStudents = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("ko-KR");
    return students.filter((student) => {
      const text = [
        student.displayName,
        student.schoolName,
        student.gradeLabel,
        student.currentVocabBook,
        ...learningSourceLabelsForStudent(learningSources, student.id),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ko-KR");
      const activities = activitiesByStudent.get(student.id) ?? [];
      const matchesWrongWords = (() => {
        if (wrongWordFilter === "all") return true;
        if (wrongWordFilter === "retry") {
          return activities.some(
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
        return wrongWordFilter === "repeated"
          ? wrongCounts.repeatedWrongWordCount > 0
          : wrongCounts.wrongWordCount > 0;
      })();
      return (
        (!keyword || text.includes(keyword)) &&
        (!schoolFilter || student.schoolName === schoolFilter) &&
        (!gradeFilter || student.gradeLabel === gradeFilter) &&
        (!wordbookFilter ||
          student.currentVocabBook === wordbookFilter ||
          (learningSourcesByStudent.get(student.id) ?? []).some(
            (source) => source.displayLabel === wordbookFilter,
          )) &&
        matchesWrongWords
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
    activitiesByStudent,
    currentVocabWrongIndex,
    gradeFilter,
    learningSources,
    learningSourcesByStudent,
    query,
    schoolFilter,
    students,
    wordbookFilter,
    wrongWordFilter,
  ]);
  const progressByStudent = useMemo(
    () => new Map(progress.map((item) => [item.studentId, item])),
    [progress],
  );
  const selectedStudentHistory = useMemo(
    () =>
      selectedStudent
        ? history.filter((item) => item.studentId === selectedStudent.id)
        : [],
    [history, selectedStudent],
  );
  const selectedStudentCurrentHistory = useMemo(
    () =>
      selectedStudent
        ? currentHistory.filter(
            (item) => item.studentId === selectedStudent.id,
          )
        : [],
    [currentHistory, selectedStudent],
  );
  const selectedStudentVocabBookHistory = useMemo(
    () =>
      selectedStudent
        ? vocabBookHistory.filter(
            (item) => item.studentId === selectedStudent.id,
          )
        : [],
    [selectedStudent, vocabBookHistory],
  );

  function closeStudentDialog() {
    studentDialogRef.current?.close();
  }

  function closeStudentDialogOnBackdrop(
    event: MouseEvent<HTMLDialogElement>,
  ) {
    if (event.target !== event.currentTarget) return;
    if (shownCode) {
      finishClosingCodeDialog();
      return;
    }
    closeStudentDialog();
  }

  return (
    <>
      {!launcherOnly ? (
        <>
          {error && (
            <div className="notice notice-error section" role="alert">
              {error}
            </div>
          )}

          <details className="card student-create-disclosure">
        <summary className={buttonRecipe({ variant: "primary" })}>
          {adminStudentsText.createStudent.open}
        </summary>
        <div className="student-create-content">
          <form
            aria-busy={busyKey === "create" || refreshPending}
            className="form-stack"
            onSubmit={createStudent}
          >
            <Field >
              <FieldLabelRow >
                <FieldLabel as="span" className="label-with-help">
                  <label htmlFor="create-student-display-name">
                    {adminStudentsText.createStudent.nameLabel}
                  </label>
                  <HelpTip label={adminStudentsText.createStudent.nameHelpAria}>
                    {adminStudentsText.createStudent.nameHelp}
                  </HelpTip>
                </FieldLabel>
                <FieldRequirement data-kind="required">
                  {adminStudentsText.createStudent.required}
                </FieldRequirement>
              </FieldLabelRow>
              <Input
                id="create-student-display-name"
                maxLength={80}
                name="displayName"
                placeholder={adminStudentsText.createStudent.namePlaceholder}
                required
              />
            </Field>
            <div className="form-grid-2">
              <Field as="label" >
                <FieldLabelRow >
                  <FieldLabel as="span" >
                    {adminStudentsText.createStudent.schoolLabel}
                  </FieldLabel>
                  <FieldRequirement >
                    {adminStudentsText.createStudent.optional}
                  </FieldRequirement>
                </FieldLabelRow>
                <Input
                  maxLength={120}
                  name="schoolName"
                  placeholder={adminStudentsText.createStudent.schoolPlaceholder}
                />
              </Field>
              <Field as="label" >
                <FieldLabelRow >
                  <FieldLabel as="span" >
                    {adminStudentsText.createStudent.gradeLabel}
                  </FieldLabel>
                  <FieldRequirement >
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
            <Field >
              <FieldLabelRow >
                <FieldLabel as="span" className="label-with-help">
                  <label htmlFor="create-student-vocab-dataset">
                    {adminStudentsText.createStudent.startingWordbookLabel}
                  </label>
                  <HelpTip
                    label={
                      adminStudentsText.createStudent.startingWordbookHelpAria
                    }
                  >
                    {adminStudentsText.createStudent.startingWordbookHelp}
                  </HelpTip>
                </FieldLabel>
                <FieldRequirement >
                  {adminStudentsText.createStudent.optional}
                </FieldRequirement>
              </FieldLabelRow>
              <Select
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
              {datasets.length === 0 ? (
                <FieldHelp >
                  {adminStudentsText.createStudent.noWordbookNotice}
                </FieldHelp>
              ) : null}
            </Field>
            <Field as="label" >
              <FieldLabelRow >
                <FieldLabel as="span" >
                  {adminStudentsText.createStudent.memoLabel}
                </FieldLabel>
                <FieldRequirement >
                  {adminStudentsText.createStudent.optional}
                </FieldRequirement>
              </FieldLabelRow>
              <Textarea
                maxLength={2000}
                name="note"
                placeholder={adminStudentsText.createStudent.memoPlaceholder}
              />
            </Field>
            {createError && (
              <div className="notice notice-error" role="alert">
                {createError}
              </div>
            )}
            <Button
              disabled={interactionBusy}
              type="submit"
              variant="primary"
            >
              {busyKey === "create"
                ? adminStudentsText.createStudent.submitting
                : refreshPending
                  ? adminStudentsText.createStudent.refreshing
                  : adminStudentsText.createStudent.submit}
            </Button>
          </form>
        </div>
      </details>

      <div className="learning-search-panel student-search-panel">
        <label className="learning-search-field">
          <span aria-hidden="true" className="learning-search-icon">
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
            onChange={(event) => setQuery(event.target.value)}
            placeholder={adminStudentsText.page.searchPlaceholder}
            type="search"
            value={query}
          />
        </label>
        <details className="learning-filter-disclosure">
          <summary>
            <span>{adminStudentsText.page.filterButton}</span>
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
              {adminStudentsText.page.resetFilters}
            </Button>
          </div>
        </div>
      </div>

      <section className="student-group-pane">
        {filteredStudents.length === 0 ? (
          <div className="empty-state">{adminStudentsText.page.noMatches}</div>
        ) : (
          <div className="student-card-grid">
                {filteredStudents.map((student) => {
                  const studentProgress = progressByStudent.get(student.id);
                  const priorityActivity =
                    activitiesByStudent.get(student.id)?.[0] ?? null;
                  const priorityPresentation = buildAttemptStatusPresentation({
                    status: priorityActivity?.status ?? null,
                    phase: priorityActivity?.phase ?? null,
                    initialScore: priorityActivity?.initialScore,
                    finalScore: priorityActivity?.finalScore,
                    passingScore: priorityActivity?.passingScore,
                    retryStartedAt: priorityActivity?.retryStartedAt,
                  });
                  const supplementalSources = (
                    learningSourcesByStudent.get(student.id) ?? []
                  )
                    .filter((source) => source.sourceType !== "primary_vocab")
                    .map((source) => ({
                      key: source.id,
                      label: `${learningSourceTypeLabel(source.sourceType)} · ${source.displayLabel}`,
                    }));
                  const primarySourceLabel =
                    student.currentVocabBook ??
                    adminStudentsText.card.wordbookMissing;
                  return (
                    <button
                      className="card student-card student-card-button"
                      data-exam-outcome={
                        priorityActivity
                          ? priorityPresentation.outcome
                          : undefined
                      }
                      key={student.id}
                      onClick={() => selectStudent(student)}
                      type="button"
                    >
                      <span className="student-card-heading">
                        <span className="student-card-title-row">
                          <strong className="student-card-name">
                            {student.displayName}
                          </strong>
                          <span className="student-card-account-statuses">
                            <StatusBadge
                              tone={
                                student.status === "active"
                                  ? "success"
                                  : "danger"
                              }
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
                        <MetaTagList className="student-card-profile-tags">
                          <MetaTag>
                            {student.schoolName ??
                              adminStudentsText.card.schoolMissing}
                          </MetaTag>
                          <MetaTag>
                            {student.gradeLabel ??
                              adminStudentsText.card.gradeMissing}
                          </MetaTag>
                        </MetaTagList>
                      </span>
                      <span className="student-card-details">
                        <span className="student-card-info-row">
                          <small>{adminStudentsText.card.recentWordbook}</small>
                          <strong
                            className="student-card-primary-source"
                            title={primarySourceLabel}
                          >
                            {primarySourceLabel}
                          </strong>
                        </span>
                        {supplementalSources.length > 0 ? (
                          <span className="student-card-info-row">
                            <small>
                              {adminStudentsText.card.learningMaterials}
                            </small>
                            <MetaTagList className="student-card-source-tags">
                              {supplementalSources
                                .slice(0, 2)
                                .map((source) => (
                                  <MetaTag key={source.key}>
                                    {source.label}
                                  </MetaTag>
                                ))}
                              {supplementalSources.length > 2 ? (
                                <MetaTag>
                                  +{supplementalSources.length - 2}
                                </MetaTag>
                              ) : null}
                            </MetaTagList>
                          </span>
                        ) : null}
                        <span className="student-card-info-row">
                          <small>{adminStudentsText.card.nextRange}</small>
                          <MetaTag tone="warning">
                            {studentRecommendationLabel(studentProgress)}
                          </MetaTag>
                        </span>
                        <span className="student-card-info-row">
                          <small>{adminStudentsText.card.priority}</small>
                          <span className="student-card-priority">
                            {priorityActivity?.primaryUnitLabels[0] ??
                            priorityActivity?.unitLabels[0] ? (
                              <MetaTag>
                                {priorityActivity?.primaryUnitLabels[0] ??
                                  priorityActivity?.unitLabels[0]}
                              </MetaTag>
                            ) : null}
                          {priorityActivity ? (
                            assignmentDisplayTitle(priorityActivity) ? (
                              <strong>{assignmentDisplayTitle(priorityActivity)}</strong>
                            ) : null
                          ) : (
                            <strong>{adminStudentsText.card.noHistory}</strong>
                          )}
                          {priorityActivity ? (
                            <span className="student-card-score-line">
                              <AttemptScoreSummary
                                compact
                                finalScore={priorityActivity.finalScore}
                                initialScore={priorityActivity.initialScore}
                                passingScore={priorityActivity.passingScore}
                                phase={priorityActivity.phase}
                                retryStartedAt={priorityActivity.retryStartedAt}
                                status={priorityActivity.status}
                              />
                              <ActivityStatusTimeline item={priorityActivity} />
                            </span>
                          ) : null}
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
      ) : null}

      {selectedStudent && (
        <ModalFrame
          aria-labelledby="student-detail-title"
          className={[
            "dialog-wide",
            "student-detail-dialog",
            assignmentStudentId
              ? "student-detail-dialog--assignment"
              : "",
            shownCode ? "student-detail-dialog--code" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={closeStudentDialogOnBackdrop}
          onCancel={(event) => {
            if (!shownCode) return;
            event.preventDefault();
            finishClosingCodeDialog();
          }}
          onClose={() => {
            setAssignmentStudentId("");
            setAssignmentDatasetId("");
            setAssignmentEditTarget(null);
            finishClosingCodeDialog();
            setSelectedStudentId("");
            setLearningView("summary");
            setLearningSourceDatasetId("");
            setLearningSourceLabel("");
            onLauncherClose?.();
          }}
          ref={studentDialogRef}
        >
          <ModalHeader
            onBack={
              assignmentStudentId
                ? () => {
                    setAssignmentStudentId("");
                    setAssignmentDatasetId("");
                    setAssignmentEditTarget(null);
                  }
                : shownCode
                  ? finishClosingCodeDialog
                : undefined
            }
            onClose={closeStudentDialog}
          >
            <div>
              <h2 id="student-detail-title">
                {assignmentStudentId
                  ? assignmentEditTarget
                    ? adminLearningText.assignmentModal.header.editTitle
                    : adminLearningText.assignmentModal.header.createTitle
                  : shownCode
                    ? shownCode.label
                  : selectedStudent.displayName}
              </h2>
              {!shownCode ? <p>
                {assignmentStudentId
                  ? selectedStudent.displayName
                  : [
                      selectedStudent.schoolName,
                      selectedStudent.gradeLabel,
                    ]
                      .filter(Boolean)
                      .join(" · ") ||
                    adminStudentsText.detail.missingSchoolGrade}
              </p> : null}
            </div>
          </ModalHeader>

          {!assignmentStudentId && !shownCode ? <Tabs
            ariaLabel={adminStudentsText.detail.tabsAria}
            className="dialog-tabs"
            items={[
              {
                value: "learning",
                label: adminStudentsText.detailTabs.learning,
                controls: "student-learning-panel",
                id: "student-learning-tab",
              },
              {
                value: "account",
                label: adminStudentsText.detailTabs.account,
                controls: "student-account-panel",
                id: "student-account-tab",
              },
              {
                value: "history",
                label: adminStudentsText.detailTabs.history,
                controls: "student-history-panel",
                id: "student-history-tab",
              },
            ]}
            onChange={(tab) => {
              setActiveTab(tab);
              if (tab === "learning") setLearningView("summary");
            }}
            value={activeTab}
          /> : null}

          {assignmentStudentId ? (
            <AssignmentManager
                currentVocabWrongSummaries={currentVocabWrongSummaries}
                datasets={assignmentDatasets}
                embedded
                history={currentHistory}
                initialDatasetId={assignmentDatasetId}
                initialDialogView="assign"
                initialEditTarget={assignmentEditTarget}
                initialStudentId={assignmentStudentId}
                key={`${assignmentStudentId}:${assignmentDatasetId}:${assignmentEditTarget?.assignmentId ?? "new"}`}
                launcherOnly
                learningSources={learningSources}
                onLauncherClose={() => {
                  setAssignmentStudentId("");
                  setAssignmentDatasetId("");
                  setAssignmentEditTarget(null);
                }}
                pendingReviewSummaries={pendingReviewSummaries}
                progress={progress}
                students={students}
                units={assignmentUnits}
            />
          ) : shownCode ? (
            <ModalBody className="student-code-dialog-body student-code-inline-body">
              <StudentCodeContent
                code={shownCode.code}
                copied={copied}
                onCopy={() => void copyCode()}
                onShare={() => void shareCode()}
              />
            </ModalBody>
          ) : (
            <ModalBody className="student-dialog-scroll-region">
              <>
            {launcherOnly && error ? (
              <div className="notice notice-error" role="alert">
                {error}
              </div>
            ) : null}
            {activeTab === "learning" ? (
              <section
                aria-labelledby="student-learning-tab"
                className="student-dialog-panel"
                id="student-learning-panel"
                key="learning"
                role="tabpanel"
              >
                {learningView === "summary" ? (
                  <div
                    className="student-learning-view student-learning-view-summary"
                    key="summary"
                  >
                    <StudentLearningSourceList
                      fallbackPrimaryLabel={selectedStudent.currentVocabBook}
                      onOpen={(view, source) => {
                        setLearningSourceDatasetId(
                          source.vocabDatasetId ?? "",
                        );
                        setLearningSourceLabel(source.displayLabel);
                        setLearningView(view);
                      }}
                      sources={
                        learningSourcesByStudent.get(selectedStudent.id) ?? []
                      }
                    />
                    <StudentVocabularyAssignmentAction
                      disabled={assignmentDatasets.length === 0}
                      onAssign={() => {
                        openStudentAssignment({
                          datasetId:
                            selectedStudent.currentVocabDatasetId ?? "",
                          studentId: selectedStudent.id,
                          editTarget: null,
                        });
                      }}
                    />
                    <div className="student-book-form compact-learning-form">
                      <Field as="label" >
                        <FieldLabel as="span" >
                          {adminStudentsText.learning.recentWordbookChange}
                        </FieldLabel>
                        <Select
                          onChange={(event) =>
                            setProfileDatasetId(event.target.value)
                          }
                          value={profileDatasetId}
                        >
                          <option value="">
                            {adminStudentsText.learning.chooseLater}
                          </option>
                          {profileDatasetId &&
                          !datasets.some(
                            (dataset) => dataset.id === profileDatasetId,
                          ) ? (
                            <option disabled value={profileDatasetId}>
                              {selectedStudent.currentVocabBook ??
                                adminStudentsText.learning.previousWordbook}{" "}
                              · {adminStudentsText.learning.assignmentClosed}
                            </option>
                          ) : null}
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
                      </Field>
                      <Button
                        disabled={
                          interactionBusy ||
                          profileDatasetId ===
                            (selectedStudent.currentVocabDatasetId ?? "")
                        }
                        onClick={saveCurrentDataset}
                        variant="secondary"
                      >
                        {adminStudentsText.learning.save}
                      </Button>
                    </div>
                    <StudentVocabBookHistoryList
                      currentDatasetId={
                        selectedStudent.currentVocabDatasetId
                      }
                      datasets={assignmentDatasets}
                      items={selectedStudentVocabBookHistory}
                    />
                    <div className="learning-section-heading">
                      <h3>{adminStudentsText.learning.recentActivity}</h3>
                      <CountBadge>
                        {formatContentText(
                          adminStudentsText.learning.activityCount,
                          { count: selectedStudentCurrentHistory.length },
                        )}
                      </CountBadge>
                    </div>
                    <StudentLearningActivityList
                      initialLimit={5}
                      items={selectedStudentCurrentHistory}
                    />
                  </div>
                ) : (
                  <div
                    className="student-learning-subview student-learning-view student-learning-view-detail"
                    key={learningView}
                  >
                    <div className="student-learning-subview-heading">
                      <IconButton
                        aria-label={adminStudentsText.learning.backAria}
                        onClick={() => setLearningView("summary")}
                        variant="quiet"
                      >
                        ←
                      </IconButton>
                      <div>
                        <h3>
                          {learningView === "vocab"
                            ? adminStudentsText.learning.vocabularyManagement
                            : adminStudentsText.learning.passageManagement}
                        </h3>
                        <p>
                          {[
                            selectedStudent.displayName,
                            learningSourceLabel,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </div>
                    {learningView === "vocab" ? (
                      <>
                        <StudentVocabularyAssignmentAction
                          disabled={assignmentDatasets.length === 0}
                          onAssign={() => {
                            openStudentAssignment({
                              datasetId:
                                learningSourceDatasetId ||
                                selectedStudent.currentVocabDatasetId ||
                                "",
                              studentId: selectedStudent.id,
                              editTarget: null,
                            });
                          }}
                        />
                        <StudentWrongWordPanel
                          active
                          cachedAt={
                            wrongHistoryByStudent[selectedStudent.id]?.loadedAt ??
                            null
                          }
                          cachedHistory={
                            wrongHistoryByStudent[selectedStudent.id]?.history ??
                            null
                          }
                          initialDatasetId={learningSourceDatasetId}
                          initialCurriculumStage={
                            selectedStudent.readingCurriculumStage
                          }
                          initialReadingContextSyncStatus={
                            selectedStudent.readingContextSyncStatus
                          }
                          key={`${selectedStudent.id}:${learningSourceDatasetId}`}
                          onDataUpdated={() => {
                            startRefreshTransition(() => router.refresh());
                          }}
                          onLoaded={cacheWrongWordHistory}
                          studentId={selectedStudent.id}
                        />
                      </>
                    ) : (
                      <div className="empty-state">
                        {adminStudentsText.learning.passagePending}
                      </div>
                    )}
                  </div>
                )}
              </section>
            ) : activeTab === "account" ? (
              <section
                aria-labelledby="student-account-tab"
                className="student-dialog-panel"
                id="student-account-panel"
                key="account"
                role="tabpanel"
              >
                <form
                  className="student-profile-form"
                  onSubmit={saveStudentProfile}
                >
                  <div className="form-grid-2">
                    <Field as="label" >
                      <FieldLabel as="span" >
                        {adminStudentsText.account.name}
                      </FieldLabel>
                      <Input
                        maxLength={80}
                        onChange={(event) =>
                          setProfileDisplayName(event.target.value)
                        }
                        required
                        value={profileDisplayName}
                      />
                    </Field>
                    <Field as="label" >
                      <FieldLabel as="span" >
                        {adminStudentsText.account.school}
                      </FieldLabel>
                      <Input
                        maxLength={120}
                        onChange={(event) =>
                          setProfileSchoolName(event.target.value)
                        }
                        value={profileSchoolName}
                      />
                    </Field>
                    <Field as="label" >
                      <FieldLabel as="span" >
                        {adminStudentsText.account.grade}
                      </FieldLabel>
                      <Input
                        maxLength={40}
                        onChange={(event) =>
                          setProfileGradeLabel(event.target.value)
                        }
                        value={profileGradeLabel}
                      />
                    </Field>
                  </div>
                  <Button
                    disabled={
                      interactionBusy ||
                      !profileDisplayName.trim() ||
                      (profileDisplayName === selectedStudent.displayName &&
                        profileSchoolName ===
                          (selectedStudent.schoolName ?? "") &&
                        profileGradeLabel ===
                          (selectedStudent.gradeLabel ?? ""))
                    }
                    type="submit"
                  >
                    {busyKey === `profile:${selectedStudent.id}`
                      ? adminStudentsText.account.savePending
                      : adminStudentsText.account.save}
                  </Button>
                </form>
                <div className="student-management-summary">
                  <div>
                    <span>{adminStudentsText.account.status}</span>
                    <strong>{selectedStudent.displayName}</strong>
                  </div>
                  <StatusBadge
                    tone={
                      selectedStudent.status === "active"
                        ? "success"
                        : "danger"
                    }
                  >
                    {selectedStudent.status === "active"
                      ? adminStudentsText.account.active
                      : adminStudentsText.account.blocked}
                  </StatusBadge>
                </div>
                {selectedStudent.codeStatus === "expired" ? (
                  <div className="notice notice-error" role="status">
                    {adminStudentsText.account.expiredNotice}
                  </div>
                ) : null}
                <div className="dialog-actions account-actions">
                  {selectedStudent.status === "active" ? (
                    <>
                      {selectedStudent.codeStatus === "active" ? (
                        <Button
                          disabled={interactionBusy}
                          onClick={() => reveal(selectedStudent)}
                          variant="quiet"
                        >
                          {adminStudentsText.account.viewCode}
                        </Button>
                      ) : null}
                      <Button
                        disabled={interactionBusy}
                        onClick={() => rotate(selectedStudent)}
                      >
                        {adminStudentsText.account.rotateCode}
                      </Button>
                      <Button
                        disabled={interactionBusy}
                        onClick={() => block(selectedStudent)}
                        variant="danger"
                      >
                        {adminStudentsText.account.block}
                      </Button>
                    </>
                  ) : (
                    <Button
                      disabled={interactionBusy}
                      onClick={() => rotate(selectedStudent)}
                      variant="primary"
                    >
                      {adminStudentsText.account.resume}
                    </Button>
                  )}
                  <Button
                    disabled={interactionBusy}
                    onClick={() => void deleteSelectedStudent()}
                    variant="danger"
                  >
                    {busyKey === `delete:${selectedStudent.id}`
                      ? adminStudentsText.account.deletePending
                      : adminStudentsText.account.delete}
                  </Button>
                </div>
              </section>
            ) : (
              <section
                aria-labelledby="student-history-tab"
                className="student-dialog-panel"
                id="student-history-panel"
                key="history"
                role="tabpanel"
              >
                <StudentLearningActivityList
                  filtersEnabled
                  initialLimit={5}
                  items={selectedStudentHistory}
                />
              </section>
            )}
              </>
            </ModalBody>
          )}
        </ModalFrame>
      )}

      {shownCode && !selectedStudent && (
        <ModalFrame
          aria-labelledby="student-code-title"
          className="student-code-dialog"
          onClick={closeCodeDialogOnBackdrop}
          onClose={finishClosingCodeDialog}
          ref={codeDialogRef}
        >
          <ModalHeader onClose={closeCodeDialog}>
            <h2 id="student-code-title">{shownCode.label}</h2>
          </ModalHeader>
          <ModalBody className="student-code-dialog-body">
            <StudentCodeContent
              code={shownCode.code}
              copied={copied}
              onCopy={() => void copyCode()}
              onShare={() => void shareCode()}
            />
          </ModalBody>
        </ModalFrame>
      )}
    </>
  );
}
