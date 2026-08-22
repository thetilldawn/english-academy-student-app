"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { koreanDateTimeLocalToIso } from "@/lib/deadline";

import {
  buildDirectReviewAssignmentRequest,
} from "../api/request-adapters";
import {
  parseAssignmentCapacityResponse,
  parseAssignmentCreationResponse,
  type AssignmentCapacityResponse,
} from "../api/response-adapters";
import type {
  AssignmentDatasetItem,
  AssignmentStudentItem,
  AssignmentUnitItem,
} from "../catalog-types";
import {
  createInitialDirectReviewDraft,
  reduceDirectReviewDraft,
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
  | "timing"
  | "deadline"
  | "preview";

type CapacityState =
  | { status: "idle"; value: null; message: "" }
  | { status: "loading"; value: AssignmentCapacityResponse | null; message: "" }
  | { status: "ready"; value: AssignmentCapacityResponse; message: "" }
  | { status: "error"; value: null; message: string };

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
  initialDatasetId,
  student,
  transport = browserAssignmentTransport,
  units,
}: {
  datasets: readonly AssignmentDatasetItem[];
  initialDatasetId: string;
  student: AssignmentStudentItem;
  transport?: AssignmentTransport;
  units: readonly AssignmentUnitItem[];
}) {
  const initialDataset = useMemo(
    () => preferredDatasetId(datasets, student, initialDatasetId),
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
  const [knownLevelCounts, setKnownLevelCounts] = useState({
    level1: null as number | null,
    level2: null as number | null,
  });
  const [submission, setSubmission] = useState({
    status: "idle" as "idle" | "submitting" | "error",
    message: "",
  });
  const [openedAt] = useState(() => Date.now());
  const submittingRef = useRef(false);

  useEffect(() => {
    if (
      !draft.datasetId ||
      draft.primaryUnitIds.length === 0 ||
      draft.reviewLevels.length === 0
    ) {
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
        setKnownLevelCounts((current) => ({
          level1: draft.reviewLevels.includes(1)
            ? value.wrongLevel1Eligible
            : current.level1,
          level2: draft.reviewLevels.includes(2)
            ? value.wrongLevel2Eligible
            : current.level2,
        }));
        if (
          draft.reviewLevels.includes(1) &&
          value.wrongLevel1Eligible === 0
        ) {
          dispatch({ type: "review_level_toggled", level: 1 });
        }
        if (
          draft.reviewLevels.includes(2) &&
          value.wrongLevel2Eligible === 0
        ) {
          dispatch({ type: "review_level_toggled", level: 2 });
        }
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
    if (capacity.status === "error") errors.preview = "계산 확인";
    if (capacity.status === "ready") {
      if (draft.questionCount === 0) errors.questionCount = "오답 없음";
      else if (draft.questionCount < 4) errors.questionCount = "4개 이상 필요";
      else if (draft.questionCount > 400) errors.questionCount = "400개까지";
      else if (
        capacity.value.minimumQuestionCount !== draft.questionCount ||
        capacity.value.maximumQuestionCount < draft.questionCount
      ) {
        errors.questionCount = "출제 조건 확인";
      }
    }
    if (![0, 50, 100].includes(draft.exam.directionRatio)) {
      errors.direction = "방향 확인";
    }
    if (!Number.isInteger(draft.exam.passingScore) ||
      draft.exam.passingScore < 0 || draft.exam.passingScore > 100) {
      errors.passingScore = "점수 확인";
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
  }, [capacity, draft, openedAt]);
  const firstFieldKey = (
    [
      "dataset",
      "reviewLevels",
      "questionCount",
      "direction",
      "questionOrder",
      "passingScore",
      "timing",
      "deadline",
      "preview",
    ] as const
  ).find((key) => fieldErrors[key]) ?? null;
  const canSubmit =
    capacity.status === "ready" &&
    Object.keys(fieldErrors).length === 0 &&
    submission.status !== "submitting";

  function changeDataset(datasetId: string) {
    const primaryUnitIds = units
      .filter((unit) => unit.datasetId === datasetId)
      .toSorted((left, right) => left.sortIndex - right.sortIndex)
      .map((unit) => unit.id);
    setKnownLevelCounts({ level1: null, level2: null });
    setCapacity({ status: "idle", value: null, message: "" });
    dispatch({ type: "dataset_changed", datasetId, primaryUnitIds });
  }

  function toggleReviewLevel(level: ReviewLevel) {
    const knownCount = level === 1
      ? knownLevelCounts.level1
      : knownLevelCounts.level2;
    if (knownCount === 0) return;
    setCapacity({ status: "idle", value: null, message: "" });
    dispatch({ type: "review_level_toggled", level });
  }

  function changeDirection(value: AssignmentDirectionRatio) {
    setCapacity({ status: "idle", value: null, message: "" });
    dispatch({ type: "direction_changed", value });
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
      const request = buildDirectReviewAssignmentRequest(draft);
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
        dispatch({ type: "deadline_changed", deadline }),
      changeDirection,
      changeOrder: (value: AssignmentQuestionOrderMode) =>
        dispatch({ type: "order_changed", value }),
      changePassingScore: (value: number) =>
        dispatch({ type: "passing_score_changed", value }),
      changeTimeLimitEnabled: (enabled: boolean) =>
        dispatch({ type: "time_limit_changed", enabled }),
      changeTiming: (timing: ExamTiming) =>
        dispatch({ type: "timing_changed", timing }),
      changeTimingMode: (mode: ExamTiming["mode"]) =>
        dispatch({ type: "timing_mode_changed", mode }),
      submit,
      toggleReviewLevel,
    },
    canSubmit,
    capacity,
    draft,
    fieldErrors,
    firstFieldKey,
    knownLevelCounts,
    message: submission.message || capacity.message,
    submitting: submission.status === "submitting",
  };
}

export type DirectReviewAssignmentController = ReturnType<
  typeof useDirectReviewAssignmentController
>;
