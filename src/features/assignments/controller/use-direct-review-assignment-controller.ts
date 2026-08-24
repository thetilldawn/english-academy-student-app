"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { koreanDateTimeLocalToIso } from "@/lib/deadline";

import {
  buildDirectReviewAssignmentRequest,
} from "../api/request-adapters";
import {
  parseAssignmentCapacityResponse,
  parseAssignmentCreationResponse,
  parseDirectReviewDatasetSummariesResponse,
  type AssignmentCapacityResponse,
  type DirectReviewDatasetSummariesResponse,
} from "../api/response-adapters";
import type {
  AssignmentDatasetItem,
  AssignmentStudentItem,
  AssignmentUnitItem,
} from "../catalog-types";
import {
  createInitialDirectReviewDraft,
  directReviewQuestionCountError,
  reduceDirectReviewDraft,
  type DirectReviewDraftAction,
} from "../domain/direct-review-draft";
import type {
  AssignmentDeadline,
  AssignmentDirectionRatio,
  AssignmentQuestionOrderMode,
  ExamTiming,
  ReviewLevel,
} from "../domain/model";
import {
  assignmentTransportError,
  browserAssignmentTransport,
  type AssignmentTransport,
} from "./assignment-transport";

export type DirectReviewFieldKey =
  | "dataset"
  | "reviewLevels"
  | "questionCount"
  | "direction"
  | "questionOrder"
  | "passingScore"
  | "retryPassingScore"
  | "timing"
  | "deadline"
  | "preview";

type CapacityState =
  | { status: "idle"; value: null; message: "" }
  | { status: "loading"; value: AssignmentCapacityResponse | null; message: "" }
  | { status: "ready"; value: AssignmentCapacityResponse; message: "" }
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

function timingError(timing: ExamTiming) {
  if (timing.mode === "total") {
    return Number.isInteger(timing.totalSeconds) &&
        timing.totalSeconds >= 30 &&
        timing.totalSeconds <= 10800
      ? ""
      : "시간 확인";
  }
  return Number.isInteger(timing.perQuestionSeconds) &&
      timing.perQuestionSeconds >= 5 &&
      timing.perQuestionSeconds <= 600
    ? ""
    : "시간 확인";
}

export function useDirectReviewAssignmentController({
  datasets,
  enabled = true,
  initialDatasetId,
  student,
  transport = browserAssignmentTransport,
  units,
}: {
  datasets: readonly AssignmentDatasetItem[];
  enabled?: boolean;
  initialDatasetId: string;
  student: AssignmentStudentItem;
  transport?: AssignmentTransport;
  units: readonly AssignmentUnitItem[];
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
  const initialUnitIds = useMemo(
    () =>
      units
        .filter((unit) => unit.datasetId === initialDataset)
        .toSorted((left, right) => left.sortIndex - right.sortIndex)
        .map((unit) => unit.id),
    [initialDataset, units],
  );
  const [draft, dispatch] = useReducer(
    reduceDirectReviewDraft,
    undefined,
    () =>
      createInitialDirectReviewDraft({
        datasetId: initialDataset,
        primaryUnitIds: initialUnitIds,
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
    status: "idle" as "idle" | "submitting" | "error",
    message: "",
  });
  const [userEdited, setUserEdited] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const submittingRef = useRef(false);
  const idempotencyRef = useRef<{
    fingerprint: string;
    key: string;
  } | null>(null);
  const calculationPrerequisitesReady = enabled &&
    summary.status === "ready" &&
    Boolean(draft.datasetId) &&
    draft.primaryUnitIds.length > 0 &&
    draft.reviewLevels.length > 0;
  const calculationPending = enabled && (
    summary.status === "idle" ||
    summary.status === "loading" ||
    (calculationPrerequisitesReady &&
      (capacity.status === "idle" || capacity.status === "loading"))
  );

  useEffect(() => {
    if (!enabled) return;
    const abortController = new AbortController();
    void (async () => {
      await Promise.resolve();
      if (abortController.signal.aborted) return;
      setCapacity({ status: "idle", value: null, message: "" });
      setSummary({ status: "loading", value: [], message: "" });
      try {
        const response = await transport({
          signal: abortController.signal,
          url: `/api/admin/students/${student.id}/direct-review-summaries`,
        });
        if (!response.ok) {
          throw new Error(assignmentTransportError(
            response.data,
            "현재 오답 단어 수를 불러오지 못했습니다.",
          ));
        }
        const value = parseDirectReviewDatasetSummariesResponse(response.data);
        if (abortController.signal.aborted) return;
        setSummary({ status: "ready", value: value.summaries, message: "" });
      } catch (error) {
        if (abortController.signal.aborted) return;
        setSummary({
          status: "error",
          value: [],
          message: error instanceof Error && error.message
            ? error.message
            : "현재 오답 단어 수를 불러오지 못했습니다.",
        });
      }
    })();
    return () => abortController.abort();
  }, [enabled, student.id, transport]);

  useEffect(() => {
    if (!enabled || summary.status !== "ready") return;
    const selectedSummary = summaryByDatasetId.get(draft.datasetId);
    if (selectedSummary) return;
    const nextDatasetId = preferredDatasetId(
      datasetOptions.map((option) => option.dataset),
      student,
      initialDatasetId,
    );
    const primaryUnitIds = units
      .filter((unit) => unit.datasetId === nextDatasetId)
      .toSorted((left, right) => left.sortIndex - right.sortIndex)
      .map((unit) => unit.id);
    const selectionChanged = draft.datasetId !== nextDatasetId ||
      draft.primaryUnitIds.length !== primaryUnitIds.length ||
      draft.primaryUnitIds.some(
        (unitId, index) => unitId !== primaryUnitIds[index],
      );
    if (selectionChanged) {
      let cancelled = false;
      void Promise.resolve().then(() => {
        if (cancelled) return;
        setCapacity({ status: "idle", value: null, message: "" });
        dispatch({
          type: "dataset_changed",
          datasetId: nextDatasetId,
          primaryUnitIds,
        });
      });
      return () => {
        cancelled = true;
      };
    }
  }, [
    datasetOptions,
    draft.datasetId,
    draft.primaryUnitIds,
    enabled,
    initialDatasetId,
    student,
    summary.status,
    summaryByDatasetId,
    units,
  ]);

  useEffect(() => {
    if (!calculationPrerequisitesReady) {
      return;
    }

    const abortController = new AbortController();
    const timer = window.setTimeout(async () => {
      setCapacity((current) => ({
        status: "loading",
        value: current.value,
        message: "",
      }));
      try {
        const response = await transport({
          body: {
            studentId: draft.studentId,
            datasetId: draft.datasetId,
            primaryUnitIds: [...draft.primaryUnitIds],
            includePendingReview: true,
            reviewSource: "current_wrong",
            reviewLevels: [...draft.reviewLevels],
            reviewScope: "dataset",
            englishToKoreanRatio: draft.exam.directionRatio,
          },
          method: "POST",
          signal: abortController.signal,
          url: "/api/admin/assignment-capacity",
        });
        if (!response.ok) {
          throw new Error(
            assignmentTransportError(
              response.data,
              "오답 문항 수를 계산하지 못했습니다.",
            ),
          );
        }
        const value = parseAssignmentCapacityResponse(response.data);
        if (abortController.signal.aborted) return;
        setCapacity({ status: "ready", value, message: "" });
        dispatch({ type: "question_count_resolved", value: value.wrongEligible });
      } catch (error) {
        if (abortController.signal.aborted) return;
        const message =
          error instanceof Error && error.message
            ? error.message
            : "오답 문항 수를 계산하지 못했습니다.";
        setCapacity({ status: "error", value: null, message });
        dispatch({ type: "question_count_resolved", value: 0 });
      }
    }, 160);

    return () => {
      window.clearTimeout(timer);
      abortController.abort();
    };
  }, [
    draft.datasetId,
    draft.exam.directionRatio,
    draft.primaryUnitIds,
    draft.reviewLevels,
    draft.studentId,
    calculationPrerequisitesReady,
    transport,
  ]);

  const fieldErrors = useMemo(() => {
    const errors: Partial<Record<DirectReviewFieldKey, string>> = {};
    if (!draft.datasetId || draft.primaryUnitIds.length === 0) {
      errors.dataset = "단어장 선택";
    }
    if (draft.reviewLevels.length === 0) {
      errors.reviewLevels = "단계 선택";
    }
    if (summary.status === "error" || capacity.status === "error") {
      errors.preview = "계산 확인";
    }
    if (capacity.status === "ready") {
      const questionCountError = directReviewQuestionCountError({
        questionCount: draft.questionCount,
        wrongEligible: capacity.value.wrongEligible,
      });
      if (questionCountError) errors.questionCount = questionCountError;
    }
    if (![0, 50, 100].includes(draft.exam.directionRatio)) {
      errors.direction = "방향 확인";
    }
    if (!Number.isInteger(draft.exam.passingScore) ||
      draft.exam.passingScore < 0 || draft.exam.passingScore > 100) {
      errors.passingScore = "점수 확인";
    }
    if (
      draft.exam.retryEnabled !== false &&
      (!Number.isInteger(draft.exam.retryPassingScore) ||
        (draft.exam.retryPassingScore ?? -1) < 0 ||
        (draft.exam.retryPassingScore ?? 101) > 100)
    ) {
      errors.retryPassingScore = "점수 확인";
    }
    if (draft.exam.timeLimitEnabled !== false) {
      const error = timingError(draft.exam.timing);
      if (error) errors.timing = error;
    }
    if (draft.deadline.mode === "at") {
      const iso = koreanDateTimeLocalToIso(draft.deadline.koreanLocalDateTime);
      if (!iso || Date.parse(iso) <= openedAt) errors.deadline = "마감 확인";
    }
    return errors;
  }, [capacity, draft, openedAt, summary.status]);
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
      "deadline",
      "preview",
    ] as const
  ).find((key) => fieldErrors[key]) ?? null;
  const canSubmit =
    enabled &&
    summary.status === "ready" &&
    capacity.status === "ready" &&
    Object.keys(fieldErrors).length === 0 &&
    submission.status !== "submitting";

  function changeDataset(datasetId: string) {
    setUserEdited(true);
    const primaryUnitIds = units
      .filter((unit) => unit.datasetId === datasetId)
      .toSorted((left, right) => left.sortIndex - right.sortIndex)
      .map((unit) => unit.id);
    setCapacity({ status: "idle", value: null, message: "" });
    dispatch({ type: "dataset_changed", datasetId, primaryUnitIds });
  }

  function toggleReviewLevel(level: ReviewLevel) {
    const knownCount = level === 1
      ? knownLevelCounts.level1
      : knownLevelCounts.level2;
    if (knownCount === 0) return;
    setUserEdited(true);
    setCapacity({ status: "idle", value: null, message: "" });
    dispatch({ type: "review_level_toggled", level });
  }

  function changeDirection(value: AssignmentDirectionRatio) {
    setUserEdited(true);
    setCapacity({ status: "idle", value: null, message: "" });
    dispatch({ type: "direction_changed", value });
  }

  function dispatchUserAction(action: DirectReviewDraftAction) {
    setUserEdited(true);
    dispatch(action);
  }

  async function submit() {
    if (!canSubmit || submittingRef.current) {
      return {
        conflict: false,
        message:
          capacity.status === "error"
            ? capacity.message
            : "오답 시험 조건을 확인해 주세요.",
        ok: false as const,
      };
    }
    submittingRef.current = true;
    setSubmission({ status: "submitting", message: "" });
    try {
      const fingerprint = JSON.stringify(draft);
      if (idempotencyRef.current?.fingerprint !== fingerprint) {
        idempotencyRef.current = {
          fingerprint,
          key: crypto.randomUUID(),
        };
      }
      const request = buildDirectReviewAssignmentRequest(
        draft,
        idempotencyRef.current.key,
      );
      const response = await transport({
        body: request.body,
        method: request.method,
        url: request.endpoint,
      });
      if (!response.ok) {
        const message = assignmentTransportError(
          response.data,
          "오답 시험을 배정하지 못했습니다.",
        );
        setSubmission({ status: "error", message });
        return {
          conflict: response.status === 409,
          message,
          ok: false as const,
        };
      }
      const result = parseAssignmentCreationResponse(response.data);
      setSubmission({ status: "idle", message: "" });
      return { ok: true as const, result };
    } catch {
      const message = "오답 시험을 배정하지 못했습니다.";
      setSubmission({ status: "error", message });
      return { conflict: false, message, ok: false as const };
    } finally {
      submittingRef.current = false;
    }
  }

  return {
    actions: {
      changeDataset,
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
