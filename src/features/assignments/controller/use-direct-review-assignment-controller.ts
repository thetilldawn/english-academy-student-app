"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  type DirectReviewDatasetSummariesResponse,
  type DirectReviewPreviewResponse,
} from "../api/response-adapters";
import {
  loadDirectReviewSummaries,
  prepareDirectReviewPreview,
  prepareDirectReviewSubmission,
  resolveDirectReviewSubmissionIssues,
} from "../application/direct-review-flow-adapter";
import type { AssignmentOperationError } from "../application/assignment-operation-error";
import type { AssignmentRequestIdentity } from "../application/request-lifecycle";
import {
  createAssignmentSubmissionFlow,
} from "../application/submission-flow";
import type {
  AssignmentDatasetItem,
  AssignmentStudentItem,
} from "../catalog-types";
import {
  createInitialDirectReviewDraft,
  reduceDirectReviewDraft,
  type DirectReviewDraftAction,
} from "../domain/direct-review-draft";
import type {
  AssignmentAvailability,
  AssignmentDeadline,
  AssignmentDirectionRatio,
  AssignmentQuestionOrderMode,
  ExamTiming,
  ReviewLevel,
} from "../domain/model";
import {
  browserAssignmentTransport,
  type AssignmentTransport,
} from "../transport/assignment-transport";
import {
  useAssignmentMinuteClock,
  useAssignmentSubmissionSession,
} from "./use-assignment-controller-runtime";
import { useDebouncedAssignmentPreview } from "./use-debounced-assignment-preview";

export type DirectReviewFieldKey =
  | "dataset"
  | "reviewLevels"
  | "questionCount"
  | "direction"
  | "questionOrder"
  | "passingScore"
  | "retryPassingScore"
  | "timing"
  | "availability"
  | "deadline"
  | "preview";

type CapacityState =
  | { status: "idle"; value: null; message: "" }
  | { status: "loading"; value: DirectReviewPreviewResponse | null; message: "" }
  | {
      status: "ready";
      value: DirectReviewPreviewResponse;
      message: "";
      fingerprint: string;
    }
  | { status: "error"; value: null; message: string };

type SummaryState =
  | { status: "idle"; value: readonly []; message: "" }
  | { status: "loading"; value: readonly []; message: "" }
  | {
      status: "ready";
      value: DirectReviewDatasetSummariesResponse["summaries"];
      message: "";
    }
  | { status: "error"; value: readonly []; message: string };

function preferredDatasetId(
  datasets: readonly AssignmentDatasetItem[],
  student: AssignmentStudentItem,
  requested: string,
) {
  const readyIds = new Set(datasets.map((dataset) => dataset.id));
  if (requested && readyIds.has(requested)) return requested;
  if (
    student.currentVocabDatasetId &&
    readyIds.has(student.currentVocabDatasetId)
  ) {
    return student.currentVocabDatasetId;
  }
  return datasets[0]?.id ?? "";
}

function directReviewFieldKey(path: string): DirectReviewFieldKey | null {
  if (path === "datasetId") return "dataset";
  if (path === "reviewLevels") return "reviewLevels";
  if (path === "questionCount") return "questionCount";
  if (path === "exam.directionRatio") return "direction";
  if (path === "exam.questionOrderMode") return "questionOrder";
  if (path === "exam.passingScore") return "passingScore";
  if (path === "exam.retryPassingScore") return "retryPassingScore";
  if (path.startsWith("exam.timing")) return "timing";
  if (path === "availability") return "availability";
  if (path === "deadline") return "deadline";
  return null;
}

function directReviewFieldErrorLabel(key: DirectReviewFieldKey): string {
  const labels: Record<DirectReviewFieldKey, string> = {
    dataset: "단어장 선택",
    reviewLevels: "횟수 선택",
    questionCount: "단어 수 확인",
    direction: "방향 확인",
    questionOrder: "순서 확인",
    passingScore: "점수 확인",
    retryPassingScore: "점수 확인",
    timing: "시간 확인",
    availability: "공개 확인",
    deadline: "마감 확인",
    preview: "계산 확인",
  };
  return labels[key];
}

const systemClock = () => Date.now();

export function useDirectReviewAssignmentController({
  datasets,
  enabled = true,
  initialDatasetId,
  student,
  clock = systemClock,
  previewDelayMs = 160,
  transport = browserAssignmentTransport,
}: {
  clock?: () => number;
  datasets: readonly AssignmentDatasetItem[];
  enabled?: boolean;
  initialDatasetId: string;
  previewDelayMs?: number;
  student: AssignmentStudentItem;
  transport?: AssignmentTransport;
}) {
  const [summary, setSummary] = useState<SummaryState>({
    status: "idle",
    value: [],
    message: "",
  });
  const summaryByDatasetId = useMemo(
    () => new Map(summary.value.map((item) => [item.datasetId, item])),
    [summary.value],
  );
  const datasetOptions = useMemo(
    () => datasets.flatMap((dataset) => {
      const count = summaryByDatasetId.get(dataset.id)?.totalCount ?? 0;
      return count > 0 ? [{ dataset, count }] : [];
    }),
    [datasets, summaryByDatasetId],
  );
  const totalAvailableCount = datasetOptions.reduce(
    (total, option) => total + option.count,
    0,
  );
  const initialDataset = useMemo(
    () => preferredDatasetId(
      datasets,
      student,
      initialDatasetId,
    ),
    [datasets, initialDatasetId, student],
  );
  const [draft, dispatch] = useReducer(
    reduceDirectReviewDraft,
    undefined,
    () =>
      createInitialDirectReviewDraft({
        datasetId: initialDataset,
        studentId: student.id,
      }),
  );
  const [capacity, setCapacity] = useState<CapacityState>({
    status: "idle",
    value: null,
    message: "",
  });
  const knownLevelCounts = useMemo(() => {
    const selectedSummary = summaryByDatasetId.get(draft.datasetId);
    return {
      level1: selectedSummary?.level1Count ?? null,
      level2: selectedSummary?.level2Count ?? null,
    };
  }, [draft.datasetId, summaryByDatasetId]);
  const [submission, setSubmission] = useState({
    status: "idle" as "idle" | "submitting" | "succeeded" | "error",
    message: "",
  });
  const [userEdited, setUserEdited] = useState(false);
  const [submissionIssue, setSubmissionIssue] = useState<{
    fieldPath: string;
    message: string;
  } | null>(null);
  const nowMilliseconds = useAssignmentMinuteClock({
    clock,
    initializeFromClock: true,
  });
  const [previewRevision, setPreviewRevision] = useState(0);
  const [sourceRefreshVersion, setSourceRefreshVersion] = useState(0);
  const submissionSession = useAssignmentSubmissionSession();
  const interactionLockedRef = useRef(false);
  const previewRecoveryFingerprintRef = useRef<string | null>(null);
  const readySummaryIdentityRef = useRef<{
    refreshVersion: number;
    studentId: string;
    transport: AssignmentTransport;
  } | null>(null);
  const submissionFlow = useMemo(
    () =>
      createAssignmentSubmissionFlow({
        busyMessage: "오답 시험을 배정하고 있습니다.",
        clock,
        createIdempotencyKey: () => crypto.randomUUID(),
        createRequestId: () => crypto.randomUUID(),
        fallback: "오답 시험을 배정하지 못했습니다.",
        session: submissionSession,
        transport,
      }),
    [clock, submissionSession, transport],
  );
  const calculationPrerequisitesReady = enabled &&
    summary.status === "ready" &&
    Boolean(draft.datasetId) &&
    draft.reviewLevels.length > 0;
  const calculationPending = enabled && (
    summary.status === "idle" ||
    summary.status === "loading" ||
    (calculationPrerequisitesReady &&
      (capacity.status === "idle" || capacity.status === "loading"))
  );

  useEffect(() => {
    if (!enabled) return;
    const readyIdentity = readySummaryIdentityRef.current;
    if (
      readyIdentity?.studentId === student.id &&
      readyIdentity.refreshVersion === sourceRefreshVersion &&
      readyIdentity.transport === transport
    ) {
      return;
    }
    const abortController = new AbortController();
    void (async () => {
      await Promise.resolve();
      if (abortController.signal.aborted) return;
      setCapacity({ status: "idle", value: null, message: "" });
      setSummary({ status: "loading", value: [], message: "" });
      const result = await loadDirectReviewSummaries({
        fallback: "현재 오답 단어 수를 불러오지 못했습니다.",
        signal: abortController.signal,
        studentId: student.id,
        transport,
      });
      if (abortController.signal.aborted) return;
      if (result.ok) {
        readySummaryIdentityRef.current = {
          refreshVersion: sourceRefreshVersion,
          studentId: student.id,
          transport,
        };
        setSummary({
          status: "ready",
          value: result.value.summaries,
          message: "",
        });
      } else if (result.error.kind !== "aborted") {
        readySummaryIdentityRef.current = null;
        setSummary({
          status: "error",
          value: [],
          message: result.error.message,
        });
      }
    })();
    return () => abortController.abort();
  }, [enabled, sourceRefreshVersion, student.id, transport]);

  useEffect(() => {
    if (!enabled || summary.status !== "ready") return;
    const selectedSummary = summaryByDatasetId.get(draft.datasetId);
    if (selectedSummary) return;
    const nextDatasetId = preferredDatasetId(
      datasetOptions.map((option) => option.dataset),
      student,
      initialDatasetId,
    );
    const selectionChanged = draft.datasetId !== nextDatasetId;
    if (selectionChanged) {
      let cancelled = false;
      void Promise.resolve().then(() => {
        if (cancelled) return;
        setCapacity({ status: "idle", value: null, message: "" });
        setPreviewRevision((revision) => revision + 1);
        dispatch({
          type: "dataset_changed",
          datasetId: nextDatasetId,
        });
      });
      return () => {
        cancelled = true;
      };
    }
  }, [
    datasetOptions,
    draft.datasetId,
    enabled,
    initialDatasetId,
    student,
    summary.status,
    summaryByDatasetId,
  ]);

  const previewPreparation = useMemo(
    () =>
      calculationPrerequisitesReady
        ? prepareDirectReviewPreview({
            datasetId: draft.datasetId,
            directionRatio: draft.exam.directionRatio,
            reviewLevels: draft.reviewLevels,
            studentId: draft.studentId,
          })
        : null,
    [
      calculationPrerequisitesReady,
      draft.datasetId,
      draft.exam.directionRatio,
      draft.reviewLevels,
      draft.studentId,
    ],
  );
  const currentPreviewFingerprint = previewPreparation?.fingerprint ?? null;
  const previewAlreadyCurrent =
    capacity.status === "ready" &&
    capacity.fingerprint === currentPreviewFingerprint;
  const handlePreviewRequested = useCallback(() => {
    setCapacity((current) => ({
      status: "loading",
      value: current.value,
      message: "",
    }));
  }, []);
  const handlePreviewSucceeded = useCallback(
    (
      value: DirectReviewPreviewResponse,
      identity: AssignmentRequestIdentity,
    ) => {
      previewRecoveryFingerprintRef.current = null;
      setCapacity({
        status: "ready",
        value,
        message: "",
        fingerprint: identity.fingerprint,
      });
      dispatch({ type: "question_count_resolved", value: value.wrongEligible });
    },
    [],
  );
  const handlePreviewFailed = useCallback(
    (
      error: AssignmentOperationError,
      identity: AssignmentRequestIdentity,
    ) => {
      if (
        error.recovery === "refresh_summary_and_preview" &&
        previewRecoveryFingerprintRef.current !== identity.fingerprint
      ) {
        previewRecoveryFingerprintRef.current = identity.fingerprint;
        setCapacity({ status: "idle", value: null, message: "" });
        setPreviewRevision((revision) => revision + 1);
        setSourceRefreshVersion((version) => version + 1);
        return;
      }
      setCapacity({ status: "error", value: null, message: error.message });
      dispatch({ type: "question_count_resolved", value: 0 });
    },
    [],
  );
  useDebouncedAssignmentPreview({
    delayMs: previewDelayMs,
    enabled: calculationPrerequisitesReady && !previewAlreadyCurrent,
    onFailed: handlePreviewFailed,
    onRequested: handlePreviewRequested,
    onSucceeded: handlePreviewSucceeded,
    preparation: previewPreparation,
    refreshVersion: sourceRefreshVersion,
    revision: previewRevision,
    transport,
  });

  const validationIssues = useMemo(
    () =>
      resolveDirectReviewSubmissionIssues(
        {
          draft,
          wrongEligible:
            capacity.status === "ready"
              ? capacity.value.wrongEligible
              : draft.questionCount,
        },
        nowMilliseconds,
      ),
    [capacity, draft, nowMilliseconds],
  );

  const fieldErrors = useMemo(() => {
    const errors: Partial<Record<DirectReviewFieldKey, string>> = {};
    for (const issue of validationIssues) {
      const key = directReviewFieldKey(issue.path);
      if (key && !errors[key]) errors[key] = directReviewFieldErrorLabel(key);
    }
    if (submissionIssue) {
      const key = directReviewFieldKey(submissionIssue.fieldPath);
      if (key) errors[key] = directReviewFieldErrorLabel(key);
    }
    if (summary.status === "error" || capacity.status === "error") {
      errors.preview = "계산 확인";
    }
    return errors;
  }, [capacity.status, submissionIssue, summary.status, validationIssues]);

  const firstFieldKey = (
    [
      "dataset",
      "reviewLevels",
      "questionCount",
      "direction",
      "questionOrder",
      "passingScore",
      "retryPassingScore",
      "timing",
      "availability",
      "deadline",
      "preview",
    ] as const
  ).find((key) => fieldErrors[key]) ?? null;
  const canSubmit =
    enabled &&
    summary.status === "ready" &&
    capacity.status === "ready" &&
    Object.keys(fieldErrors).length === 0 &&
    submission.status !== "submitting" &&
    submission.status !== "succeeded";

  function changeDataset(datasetId: string) {
    if (interactionLockedRef.current) return;
    setUserEdited(true);
    setSubmission({ status: "idle", message: "" });
    setSubmissionIssue(null);
    setCapacity({ status: "idle", value: null, message: "" });
    setPreviewRevision((revision) => revision + 1);
    dispatch({ type: "dataset_changed", datasetId });
  }

  function toggleReviewLevel(level: ReviewLevel) {
    if (interactionLockedRef.current) return;
    const knownCount = level === 1
      ? knownLevelCounts.level1
      : knownLevelCounts.level2;
    if (knownCount === 0) return;
    setUserEdited(true);
    setSubmission({ status: "idle", message: "" });
    setSubmissionIssue(null);
    setCapacity({ status: "idle", value: null, message: "" });
    setPreviewRevision((revision) => revision + 1);
    dispatch({ type: "review_level_toggled", level });
  }

  function changeDirection(value: AssignmentDirectionRatio) {
    if (interactionLockedRef.current) return;
    setUserEdited(true);
    setSubmission({ status: "idle", message: "" });
    setSubmissionIssue(null);
    setCapacity({ status: "idle", value: null, message: "" });
    setPreviewRevision((revision) => revision + 1);
    dispatch({ type: "direction_changed", value });
  }

  function dispatchUserAction(action: DirectReviewDraftAction) {
    if (interactionLockedRef.current) return;
    setUserEdited(true);
    setSubmission({ status: "idle", message: "" });
    setSubmissionIssue(null);
    dispatch(action);
  }

  async function submit() {
    const alreadySubmitting = interactionLockedRef.current;
    if (
      !enabled ||
      submission.status === "succeeded" ||
      summary.status !== "ready" ||
      capacity.status !== "ready"
    ) {
      return {
        conflict: false,
        fieldKey: firstFieldKey,
        message:
          capacity.status === "error"
            ? capacity.message
            : "오답 시험 조건을 확인해 주세요.",
        ok: false as const,
      };
    }
    if (!alreadySubmitting) {
      interactionLockedRef.current = true;
      setSubmission({ status: "submitting", message: "" });
      setSubmissionIssue(null);
    }
    let outcome: Awaited<ReturnType<typeof submissionFlow.run>>;
    try {
      outcome = await submissionFlow.run((now) =>
        prepareDirectReviewSubmission(
          { draft, wrongEligible: capacity.value.wrongEligible },
          now,
        )
      );
    } finally {
      if (!alreadySubmitting) interactionLockedRef.current = false;
    }
    if (outcome.ok) {
      setSubmission({ status: "succeeded", message: "" });
      return { ok: true as const, result: outcome.value };
    }
    if (outcome.error.kind === "busy") {
      return {
        conflict: false,
        fieldKey: null,
        message: outcome.error.message,
        ok: false as const,
      };
    }
    if (outcome.error.fieldPath) {
      setSubmissionIssue({
        fieldPath: outcome.error.fieldPath,
        message: outcome.error.message,
      });
    }
    setSubmission({ status: "error", message: outcome.error.message });
    if (outcome.error.recovery === "refresh_summary_and_preview") {
      setCapacity({ status: "idle", value: null, message: "" });
      setPreviewRevision((revision) => revision + 1);
      setSourceRefreshVersion((version) => version + 1);
    }
    return {
      conflict: outcome.error.kind === "conflict",
      fieldKey: directReviewFieldKey(outcome.error.fieldPath ?? ""),
      message: outcome.error.message,
      ok: false as const,
    };
  }

  return {
    actions: {
      changeDataset,
      changeAvailability: (availability: AssignmentAvailability) =>
        dispatchUserAction({ type: "availability_changed", availability }),
      changeDeadline: (deadline: AssignmentDeadline) =>
        dispatchUserAction({ type: "deadline_changed", deadline }),
      changeDirection,
      changeOrder: (value: AssignmentQuestionOrderMode) =>
        dispatchUserAction({ type: "order_changed", value }),
      changePassingScore: (value: number) =>
        dispatchUserAction({ type: "passing_score_changed", value }),
      changeRetryEnabled: (enabled: boolean) =>
        dispatchUserAction({ type: "retry_enabled_changed", enabled }),
      changeRetryPassingScore: (value: number) =>
        dispatchUserAction({ type: "retry_passing_score_changed", value }),
      changeTimeLimitEnabled: (enabled: boolean) =>
        dispatchUserAction({ type: "time_limit_changed", enabled }),
      changeTiming: (timing: ExamTiming) =>
        dispatchUserAction({ type: "timing_changed", timing }),
      changeTimingMode: (mode: ExamTiming["mode"]) =>
        dispatchUserAction({ type: "timing_mode_changed", mode }),
      submit,
      toggleReviewLevel,
    },
    calculationPending,
    canSubmit,
    capacity,
    draft,
    fieldErrors,
    firstFieldKey,
    knownLevelCounts,
    datasetOptions,
    summary,
    userEdited,
    totalAvailableCount,
    message: submission.message || capacity.message || summary.message,
    submitting: submission.status === "submitting",
  };
}

export type DirectReviewAssignmentController = ReturnType<
  typeof useDirectReviewAssignmentController
>;
