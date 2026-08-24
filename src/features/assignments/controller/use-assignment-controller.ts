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
  assignmentCapacityFingerprint,
  buildAssignmentEditDraftRequest,
  buildSingleAssignmentRequest,
  replacementSubmissionFingerprint,
} from "../api/request-adapters";
import { hydrateSingleAssignmentDraftFromEditResponse } from "../api/edit-draft-adapter";
import {
  parseAssignmentCreationResponse,
  parseAssignmentEditDraftResponse,
  parseAssignmentReplacementResponse,
  type AssignmentCapacityResponse,
  type AssignmentCreationResponse,
  type AssignmentReplacementResponse,
} from "../api/response-adapters";
import {
  createAssignmentEditorState,
  reduceAssignmentEditorState,
  type AssignmentEditorAction,
  type AssignmentEditorState,
} from "../domain/editor-state";
import { deriveSingleAssignmentSubmitBlocker } from "../domain/submit-blocker";
import {
  assignmentRequestFingerprint,
  reserveIdempotencyKey,
  type IdempotencyReservation,
} from "../domain/fingerprint";
import type {
  AssignmentDeadline,
  AssignmentDirectionRatio,
  AssignmentQuestionOrderMode,
  ExamTiming,
  ReviewLevel,
  ReviewPolicy,
  ReviewScope,
  SingleAssignmentDraft,
} from "../domain/model";
import {
  reduceSingleAssignmentDraft,
  resolveSingleAssignmentDraft,
  type SingleAssignmentDraftAction,
} from "../domain/single-draft";
import { validateSingleAssignmentSubmission } from "../domain/validation";
import {
  assignmentTransportError,
  browserAssignmentTransport,
  type AssignmentTransport,
} from "../transport/assignment-transport";
import { useAssignmentPreview } from "./use-assignment-preview";

export type SingleAssignmentResult =
  | AssignmentCreationResponse
  | AssignmentReplacementResponse;

type ControllerState = AssignmentEditorState<
  SingleAssignmentDraft,
  AssignmentCapacityResponse,
  SingleAssignmentResult
>;

type ControllerAction = AssignmentEditorAction<
  SingleAssignmentDraft,
  AssignmentCapacityResponse,
  SingleAssignmentResult
>;

export type AssignmentControllerSource =
  | { kind: "create"; initialDraft: SingleAssignmentDraft }
  | {
      assignmentId: string;
      fallbackDraft: SingleAssignmentDraft;
      kind: "edit";
      studentId: string;
    };

export type AssignmentSubmitOutcome =
  | { ok: true; result: SingleAssignmentResult }
  | { conflict: boolean; message: string; ok: false };

export function createInitialSingleAssignmentDraft({
  deadline = { mode: "none" },
  datasetId,
  exam = {
    directionRatio: 50,
    passingScore: 80,
    retryEnabled: true,
    retryPassingScore: 80,
    questionOrderMode: "random",
    timeLimitEnabled: true,
    timing: { mode: "total", totalSeconds: 300 },
  },
  orderedUnitIds,
  studentId,
}: {
  deadline?: AssignmentDeadline;
  datasetId: string;
  exam?: SingleAssignmentDraft["exam"];
  orderedUnitIds: readonly string[];
  studentId: string;
}): SingleAssignmentDraft {
  return {
    kind: "single",
    operation: { mode: "create" },
    studentId,
    title: { mode: "automatic" },
    range: { datasetId, orderedUnitIds: [...orderedUnitIds] },
    questionCount: { mode: "automatic", value: 20 },
    exam,
    deadline,
    review: { mode: "none", scope: "dataset", levels: [1, 2] },
  };
}

function isExactReviewEdit(draft: SingleAssignmentDraft) {
  return (
    draft.operation.mode === "replace" &&
    draft.operation.sourcePurpose === "review"
  );
}

function safeCapacityFingerprint(draft: SingleAssignmentDraft) {
  try {
    return assignmentCapacityFingerprint(draft);
  } catch {
    return null;
  }
}

export function useAssignmentController({
  automaticTitleForDraft,
  capacityErrorMessage,
  editLoadErrorMessage,
  genericErrorMessage,
  onConflict,
  previewDelayMs = 120,
  source,
  clock = systemClock,
  transport = browserAssignmentTransport,
}: {
  automaticTitleForDraft: (
    draft: SingleAssignmentDraft,
    capacity: AssignmentCapacityResponse | null,
  ) => string;
  capacityErrorMessage: string;
  editLoadErrorMessage: string;
  genericErrorMessage: string;
  onConflict?: () => void;
  previewDelayMs?: number;
  source: AssignmentControllerSource;
  clock?: () => number;
  transport?: AssignmentTransport;
}) {
  const initialDraft =
    source.kind === "create" ? source.initialDraft : source.fallbackDraft;
  const [state, dispatch] = useReducer(
    reduceAssignmentEditorState<
      SingleAssignmentDraft,
      AssignmentCapacityResponse,
      SingleAssignmentResult
    >,
    initialDraft,
    (draft) =>
      createAssignmentEditorState<
        SingleAssignmentDraft,
        AssignmentCapacityResponse,
        SingleAssignmentResult
      >(draft),
  );
  const stateRef = useRef<ControllerState>(state);
  const [baselineDraft, setBaselineDraft] =
    useState<SingleAssignmentDraft | null>(null);
  const [loadStatus, setLoadStatus] = useState<
    "loading" | "ready" | "error"
  >(source.kind === "edit" ? "loading" : "ready");
  const [message, setMessage] = useState("");
  const [previewRefreshVersion, setPreviewRefreshVersion] = useState(0);
  const [nowMilliseconds, setNowMilliseconds] = useState(0);
  const idempotencyRef = useRef<IdempotencyReservation | null>(null);
  const timingMemoryRef = useRef({
    perQuestionSeconds:
      initialDraft.exam.timing.mode === "per_question"
        ? initialDraft.exam.timing.perQuestionSeconds
        : 20,
    totalSeconds:
      initialDraft.exam.timing.mode === "total"
        ? initialDraft.exam.timing.totalSeconds
        : 300,
  });
  const sourceKind = source.kind;
  const sourceAssignmentId =
    source.kind === "edit" ? source.assignmentId : null;
  const sourceStudentId = source.kind === "edit" ? source.studentId : null;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const updateNow = () => setNowMilliseconds(clock());
    updateNow();
    const intervalId = window.setInterval(updateNow, 60_000);
    return () => window.clearInterval(intervalId);
  }, [clock]);

  const apply = useCallback((action: ControllerAction) => {
    stateRef.current = reduceAssignmentEditorState(
      stateRef.current,
      action,
    );
    dispatch(action);
  }, []);

  useEffect(() => {
    if (
      sourceKind !== "edit" ||
      sourceAssignmentId === null ||
      sourceStudentId === null
    ) {
      return;
    }
    const abortController = new AbortController();
    const request = buildAssignmentEditDraftRequest(
      sourceAssignmentId,
      sourceStudentId,
    );
    void transport({
      method: request.method,
      signal: abortController.signal,
      url: request.endpoint,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            assignmentTransportError(response.data, editLoadErrorMessage),
          );
        }
        const parsed = parseAssignmentEditDraftResponse(response.data);
        if (
          parsed.assignmentId !== sourceAssignmentId ||
          parsed.studentId !== sourceStudentId
        ) {
          throw new Error(editLoadErrorMessage);
        }
        const hydrated = hydrateSingleAssignmentDraftFromEditResponse(parsed);
        if (hydrated.exam.timing.mode === "total") {
          timingMemoryRef.current.totalSeconds =
            hydrated.exam.timing.totalSeconds;
        } else {
          timingMemoryRef.current.perQuestionSeconds =
            hydrated.exam.timing.perQuestionSeconds;
        }
        setBaselineDraft(hydrated);
        idempotencyRef.current = null;
        apply({ type: "draft/replaced", draft: hydrated });
        setLoadStatus("ready");
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) return;
        setMessage(
          error instanceof Error ? error.message : editLoadErrorMessage,
        );
        setLoadStatus("error");
      });
    return () => abortController.abort();
  }, [
    apply,
    editLoadErrorMessage,
    sourceAssignmentId,
    sourceKind,
    sourceStudentId,
    transport,
  ]);

  useAssignmentPreview({
    apply,
    delayMs: previewDelayMs,
    enabled: loadStatus === "ready",
    errorMessage: capacityErrorMessage,
    refreshVersion: previewRefreshVersion,
    state,
    transport,
  });

  const changeDraft = useCallback(
    (action: SingleAssignmentDraftAction) => {
      const currentDraft = stateRef.current.draft;
      const nextDraft = reduceSingleAssignmentDraft(currentDraft, action);
      if (nextDraft === currentDraft) return;
      const currentCapacityFingerprint = safeCapacityFingerprint(currentDraft);
      const nextCapacityFingerprint = safeCapacityFingerprint(nextDraft);
      idempotencyRef.current = null;
      setMessage("");
      apply({
        type: "draft/replaced",
        draft: nextDraft,
        previewImpact:
          currentCapacityFingerprint !== null &&
          currentCapacityFingerprint === nextCapacityFingerprint
            ? "preserve"
            : "invalidate",
      });
    },
    [apply],
  );

  const capacity = state.preview.status === "ready" ? state.preview.value : null;
  const automaticTitle = automaticTitleForDraft(state.draft, capacity);
  const resolved = resolveSingleAssignmentDraft(state.draft, {
    title: automaticTitle,
  });
  const minimumQuestionCount = isExactReviewEdit(state.draft) ? 1 : 4;
  const issues = validateSingleAssignmentSubmission(
    state.draft,
    resolved,
    nowMilliseconds,
  );
  const dirty = baselineDraft
    ? assignmentRequestFingerprint(state.draft) !==
      assignmentRequestFingerprint(baselineDraft)
    : true;
  const capacityReadyForCurrentDraft =
    state.preview.status === "ready" &&
    state.preview.revision === state.revision;
  const submitBlocker = deriveSingleAssignmentSubmitBlocker({
    capacity,
    capacityReadyForCurrentDraft,
    dirty,
    issues,
    loadStatus,
    minimumQuestionCount,
    questionCount: resolved.questionCount,
    previewStatus: state.preview.status,
    reviewMode: state.draft.review.mode,
    submissionStatus: state.submission.status,
  });
  const canSubmit = submitBlocker === null;

  const submit = useCallback(async (): Promise<AssignmentSubmitOutcome> => {
    let current = stateRef.current;
    if (
      current.submission.status === "submitting" ||
      current.submission.status === "succeeded"
    ) {
      return { conflict: false, message: genericErrorMessage, ok: false };
    }
    if (current.submission.status !== "idle") {
      apply({ type: "submission/reset" });
      current = stateRef.current;
    }
    const currentCapacity =
      current.preview.status === "ready" ? current.preview.value : null;
    const currentResolved = resolveSingleAssignmentDraft(current.draft, {
      title: automaticTitleForDraft(current.draft, currentCapacity),
    });
    const currentMinimumQuestionCount = isExactReviewEdit(current.draft)
      ? 1
      : 4;
    const currentIssues = validateSingleAssignmentSubmission(
      current.draft,
      currentResolved,
      clock(),
    );
    const currentDirty = baselineDraft
      ? assignmentRequestFingerprint(current.draft) !==
        assignmentRequestFingerprint(baselineDraft)
      : true;
    const currentBlocker = deriveSingleAssignmentSubmitBlocker({
      capacity: currentCapacity,
      capacityReadyForCurrentDraft:
        current.preview.status === "ready" &&
        current.preview.revision === current.revision,
      dirty: currentDirty,
      issues: currentIssues,
      loadStatus,
      minimumQuestionCount: currentMinimumQuestionCount,
      previewStatus: current.preview.status,
      questionCount: currentResolved.questionCount,
      reviewMode: current.draft.review.mode,
      submissionStatus: current.submission.status,
    });
    if (currentBlocker) {
      setMessage(capacityErrorMessage);
      return {
        conflict: false,
        message: capacityErrorMessage,
        ok: false,
      };
    }
    let request: ReturnType<typeof buildSingleAssignmentRequest>;
    try {
      const requestOptions: {
        idempotencyKey?: string;
        nowMilliseconds: number;
      } = { nowMilliseconds: clock() };
      if (current.draft.operation.mode === "replace") {
        const fingerprint = replacementSubmissionFingerprint(
          current.draft,
          currentResolved,
          requestOptions.nowMilliseconds,
        );
        idempotencyRef.current = reserveIdempotencyKey(
          idempotencyRef.current,
          fingerprint,
          () => crypto.randomUUID(),
        );
        requestOptions.idempotencyKey = idempotencyRef.current.key;
      }
      request = buildSingleAssignmentRequest(
        current.draft,
        currentResolved,
        requestOptions,
      );
    } catch (error: unknown) {
      const nextMessage =
        error instanceof Error ? error.message : genericErrorMessage;
      setMessage(nextMessage);
      return { conflict: false, message: nextMessage, ok: false };
    }

    const requestId = crypto.randomUUID();
    const fingerprint = assignmentRequestFingerprint(request.body);
    const revision = stateRef.current.revision;
    apply({
      type: "submission/requested",
      fingerprint,
      requestId,
      revision,
    });
    if (
      stateRef.current.submission.status !== "submitting" ||
      stateRef.current.submission.requestId !== requestId
    ) {
      const nextMessage = capacityErrorMessage;
      setMessage(nextMessage);
      return { conflict: false, message: nextMessage, ok: false };
    }
    setMessage("");

    try {
      const response = await transport({
        body: request.body,
        method: request.method,
        url: request.endpoint,
      });
      if (!response.ok) {
        const nextMessage = assignmentTransportError(
          response.data,
          genericErrorMessage,
        );
        if (response.status === 409) {
          apply({
            type: "submission/conflicted",
            message: nextMessage,
            requestId,
            revision,
          });
          apply({ type: "submission/reset" });
          setPreviewRefreshVersion((version) => version + 1);
          setMessage(nextMessage);
          onConflict?.();
          return { conflict: true, message: nextMessage, ok: false };
        }
        throw new Error(nextMessage);
      }
      const result =
        request.method === "PUT"
          ? parseAssignmentReplacementResponse(response.data)
          : parseAssignmentCreationResponse(response.data);
      apply({
        type: "submission/succeeded",
        requestId,
        result,
        revision,
      });
      return { ok: true, result };
    } catch (error: unknown) {
      const nextMessage =
        error instanceof Error ? error.message : genericErrorMessage;
      apply({
        type: "submission/failed",
        message: nextMessage,
        requestId,
        revision,
      });
      apply({ type: "submission/reset" });
      setMessage(nextMessage);
      return { conflict: false, message: nextMessage, ok: false };
    }
  }, [
    apply,
    automaticTitleForDraft,
    baselineDraft,
    capacityErrorMessage,
    clock,
    genericErrorMessage,
    loadStatus,
    onConflict,
    transport,
  ]);

  const actions = useMemo(
    () => ({
      changeDataset(datasetId: string) {
        changeDraft({ type: "dataset/changed", datasetId });
      },
      changeDeadline(deadline: AssignmentDeadline) {
        changeDraft({ type: "deadline/changed", deadline });
      },
      changeDirection(directionRatio: AssignmentDirectionRatio) {
        changeDraft({
          type: "exam/changed",
          exam: { ...stateRef.current.draft.exam, directionRatio },
        });
      },
      changeOrder(questionOrderMode: AssignmentQuestionOrderMode) {
        changeDraft({
          type: "exam/changed",
          exam: { ...stateRef.current.draft.exam, questionOrderMode },
        });
      },
      changePassingScore(passingScore: number) {
        changeDraft({
          type: "exam/changed",
          exam: { ...stateRef.current.draft.exam, passingScore },
        });
      },
      changeRetryEnabled(retryEnabled: boolean) {
        changeDraft({
          type: "exam/changed",
          exam: { ...stateRef.current.draft.exam, retryEnabled },
        });
      },
      changeRetryPassingScore(retryPassingScore: number) {
        changeDraft({
          type: "exam/changed",
          exam: { ...stateRef.current.draft.exam, retryPassingScore },
        });
      },
      changeQuestionCount(value: number) {
        changeDraft({ type: "questionCount/manuallyChanged", value });
      },
      changeRange(datasetId: string, orderedUnitIds: readonly string[]) {
        changeDraft({
          type: "range/changed",
          range: { datasetId, orderedUnitIds: [...orderedUnitIds] },
        });
      },
      changeReview(review: ReviewPolicy) {
        changeDraft({ type: "review/changed", review });
      },
      changeReviewMode(mode: ReviewPolicy["mode"]) {
        const current = stateRef.current.draft.review;
        changeDraft({
          type: "review/changed",
          review: { ...current, mode },
        });
      },
      changeReviewScope(scope: ReviewScope) {
        const current = stateRef.current.draft.review;
        changeDraft({
          type: "review/changed",
          review: { ...current, scope },
        });
      },
      changeTiming(timing: ExamTiming) {
        if (timing.mode === "total") {
          timingMemoryRef.current.totalSeconds = timing.totalSeconds;
        } else {
          timingMemoryRef.current.perQuestionSeconds =
            timing.perQuestionSeconds;
        }
        changeDraft({
          type: "exam/changed",
          exam: { ...stateRef.current.draft.exam, timing },
        });
      },
      changeTimeLimitEnabled(timeLimitEnabled: boolean) {
        changeDraft({
          type: "exam/changed",
          exam: { ...stateRef.current.draft.exam, timeLimitEnabled },
        });
      },
      changeTimingMode(mode: ExamTiming["mode"]) {
        const timing: ExamTiming =
          mode === "total"
            ? {
                mode: "total",
                totalSeconds: timingMemoryRef.current.totalSeconds,
              }
            : {
                mode: "per_question",
                perQuestionSeconds:
                  timingMemoryRef.current.perQuestionSeconds,
              };
        changeDraft({
          type: "exam/changed",
          exam: { ...stateRef.current.draft.exam, timing },
        });
      },
      changeTitle(value: string) {
        changeDraft(
          value.trim()
            ? { type: "title/changed", value }
            : { type: "title/restoreAutomatic" },
        );
      },
      restoreAutomaticCount() {
        const currentCapacity =
          stateRef.current.preview.status === "ready"
            ? stateRef.current.preview.value
            : null;
        if (!currentCapacity) return;
        changeDraft({
          type: "questionCount/restoreAutomatic",
          recommendedQuestionCount:
            currentCapacity.recommendedQuestionCount,
        });
      },
      retryPreview() {
        setPreviewRefreshVersion((version) => version + 1);
      },
      submit,
      toggleReviewLevel(level: ReviewLevel) {
        const current = stateRef.current.draft.review;
        const levels = current.levels.includes(level)
          ? current.levels.filter((candidate) => candidate !== level)
          : [...current.levels, level].toSorted();
        changeDraft({
          type: "review/changed",
          review: { ...current, levels },
        });
      },
    }),
    [changeDraft, submit],
  );

  return {
    actions,
    automaticTitle,
    baselineDraft,
    canSubmit,
    capacity,
    dirty,
    isExactReview: isExactReviewEdit(state.draft),
    issues,
    loadStatus,
    message,
    minimumQuestionCount,
    resolved,
    state,
    submitBlocker,
  };
}

export type SingleAssignmentController = ReturnType<
  typeof useAssignmentController
>;

function systemClock() {
  return Date.now();
}
