"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  buildBulkAssignmentPreviewRequest,
  buildBulkAssignmentRequest,
  bulkPreviewFingerprint,
  bulkSubmissionFingerprint,
} from "../api/request-adapters";
import {
  parseBulkAssignmentCreationResponse,
  parseBulkAssignmentPreviewResponse,
  type BulkAssignmentCreationResponse,
  type BulkAssignmentPreviewResponse,
} from "../api/response-adapters";
import {
  createInitialBulkSeriesAssignmentDraft,
  reduceBulkSeriesAssignmentDraft,
  type BulkSeriesAssignmentDraftAction,
} from "../domain/bulk-draft";
import {
  createAssignmentEditorState,
  reduceAssignmentEditorState,
  type AssignmentEditorAction,
  type AssignmentEditorState,
} from "../domain/editor-state";
import {
  reserveIdempotencyKey,
  type IdempotencyReservation,
} from "../domain/fingerprint";
import type {
  AssignmentDeadline,
  AssignmentDirectionRatio,
  AssignmentQuestionOrderMode,
  BulkSeriesAssignmentDraft,
  ExamTiming,
  ReviewLevel,
} from "../domain/model";
import {
  validateBulkAssignmentSubmission,
  validateBulkPreviewProjection,
} from "../domain/validation";
import {
  assignmentTransportError,
  browserAssignmentTransport,
  type AssignmentTransport,
} from "./assignment-transport";

type ControllerState = AssignmentEditorState<
  BulkSeriesAssignmentDraft,
  BulkAssignmentPreviewResponse,
  BulkAssignmentCreationResponse
>;

type ControllerAction = AssignmentEditorAction<
  BulkSeriesAssignmentDraft,
  BulkAssignmentPreviewResponse,
  BulkAssignmentCreationResponse
>;

export type BulkAssignmentSubmitOutcome =
  | { ok: true; result: BulkAssignmentCreationResponse }
  | { conflict: boolean; message: string; ok: false };

function safePreviewFingerprint(draft: BulkSeriesAssignmentDraft) {
  try {
    return bulkPreviewFingerprint(draft);
  } catch {
    return null;
  }
}

function previewAllowsSubmission(
  draft: BulkSeriesAssignmentDraft,
  preview: BulkAssignmentPreviewResponse,
) {
  return (
    preview.blockedCount === 0 &&
    preview.items.every((item) => !item.requiresExtraDateDecision) &&
    (draft.commonPlan
      ? preview.assignableCount > 0 &&
        preview.assignmentCount > 0 &&
        preview.assignmentCount === preview.items.reduce(
          (count, item) => count + item.sessions.length,
          0,
        )
      : preview.assignableCount === draft.studentIds.length &&
        preview.assignmentCount ===
        draft.studentIds.length * draft.range.sessionCount)
  );
}

const systemClock = () => Date.now();

export function useBulkAssignmentController({
  firstAvailableDateKorean,
  genericErrorMessage,
  initialCommonPlan,
  includePendingReview,
  previewDelayMs = 120,
  previewErrorMessage,
  studentIds,
  clock = systemClock,
  commonPlanRequired = false,
  commonPlanRequiredMessage = "단어장, 범위, 날짜를 먼저 정해 주세요.",
  transport = browserAssignmentTransport,
}: {
  firstAvailableDateKorean: string;
  genericErrorMessage: string;
  initialCommonPlan?: BulkSeriesAssignmentDraft["commonPlan"];
  includePendingReview: boolean;
  previewDelayMs?: number;
  previewErrorMessage: string;
  studentIds: readonly string[];
  clock?: () => number;
  commonPlanRequired?: boolean;
  commonPlanRequiredMessage?: string;
  transport?: AssignmentTransport;
}) {
  const [initialDraft] = useState(() =>
    createInitialBulkSeriesAssignmentDraft({
      firstAvailableDateKorean,
      includePendingReview,
      commonPlan: initialCommonPlan,
      studentIds,
    }),
  );
  const [state, dispatch] = useReducer(
    reduceAssignmentEditorState<
      BulkSeriesAssignmentDraft,
      BulkAssignmentPreviewResponse,
      BulkAssignmentCreationResponse
    >,
    initialDraft,
    (draft) =>
      createAssignmentEditorState<
        BulkSeriesAssignmentDraft,
        BulkAssignmentPreviewResponse,
        BulkAssignmentCreationResponse
      >(draft),
  );
  const stateRef = useRef<ControllerState>(state);
  const [message, setMessage] = useState("");
  const [previewRefreshVersion, setPreviewRefreshVersion] = useState(0);
  const [nowMilliseconds, setNowMilliseconds] = useState(() => clock());
  const idempotencyRef = useRef<IdempotencyReservation | null>(null);
  const submittingRef = useRef(false);
  const timingMemoryRef = useRef({
    perQuestionSeconds: 20,
    totalSeconds: 300,
  });
  const handledRefreshVersionRef = useRef(previewRefreshVersion);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const updateNow = () => setNowMilliseconds(clock());
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

  const changeDraft = useCallback(
    (action: BulkSeriesAssignmentDraftAction) => {
      const currentDraft = stateRef.current.draft;
      const nextDraft = reduceBulkSeriesAssignmentDraft(
        currentDraft,
        action,
      );
      const currentFingerprint = safePreviewFingerprint(currentDraft);
      const nextFingerprint = safePreviewFingerprint(nextDraft);
      setMessage("");
      apply({
        type: "draft/replaced",
        draft: nextDraft,
        previewImpact:
          currentFingerprint !== null &&
          currentFingerprint === nextFingerprint
            ? "preserve"
            : "invalidate",
      });
    },
    [apply],
  );

  useEffect(() => {
    const draft = state.draft;
    if (commonPlanRequired && !draft.commonPlan) return;
    const issues = validateBulkPreviewProjection(draft);
    if (issues.length > 0) return;
    const request = buildBulkAssignmentPreviewRequest(draft);
    const fingerprint = bulkPreviewFingerprint(draft);
    const forceRefresh =
      handledRefreshVersionRef.current !== previewRefreshVersion;
    handledRefreshVersionRef.current = previewRefreshVersion;
    const currentState = stateRef.current;
    if (
      !forceRefresh &&
      currentState.preview.status === "ready" &&
      currentState.preview.revision === state.revision &&
      currentState.preview.fingerprint === fingerprint
    ) {
      return;
    }

    const abortController = new AbortController();
    const requestId = crypto.randomUUID();
    const timeoutId = window.setTimeout(() => {
      apply({
        type: "preview/requested",
        revision: state.revision,
        requestId,
        fingerprint,
      });
      void transport({
        body: request.body,
        method: request.method,
        signal: abortController.signal,
        url: request.endpoint,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(
              assignmentTransportError(
                response.data,
                previewErrorMessage,
              ),
            );
          }
          let parsed: BulkAssignmentPreviewResponse;
          try {
            parsed = parseBulkAssignmentPreviewResponse(response.data);
          } catch {
            throw new Error(previewErrorMessage);
          }
          apply({
            type: "preview/succeeded",
            revision: state.revision,
            requestId,
            fingerprint,
            value: parsed,
          });
        })
        .catch((error: unknown) => {
          if (abortController.signal.aborted) return;
          apply({
            type: "preview/failed",
            revision: state.revision,
            requestId,
            fingerprint,
            message:
              error instanceof Error ? error.message : previewErrorMessage,
          });
        });
    }, previewDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [
    apply,
    commonPlanRequired,
    previewDelayMs,
    previewErrorMessage,
    previewRefreshVersion,
    state.draft,
    state.revision,
    transport,
  ]);

  const missingCommonPlan = commonPlanRequired && !state.draft.commonPlan;
  const previewIssues = missingCommonPlan
    ? [{
        code: "required" as const,
        path: "commonPlan",
        message: commonPlanRequiredMessage,
      }]
    : validateBulkPreviewProjection(state.draft);
  const submissionIssues = missingCommonPlan
    ? previewIssues
    : validateBulkAssignmentSubmission(state.draft, nowMilliseconds);
  const currentPreviewFingerprint = safePreviewFingerprint(state.draft);
  const preview =
    state.preview.status === "ready" &&
    state.preview.revision === state.revision &&
    state.preview.fingerprint === currentPreviewFingerprint
      ? state.preview.value
      : null;
  const previewLoading =
    previewIssues.length === 0 &&
    (state.preview.status === "idle" || state.preview.status === "loading");
  const displayedMessage =
    message ||
    previewIssues[0]?.message ||
    (state.preview.status === "error" ? state.preview.message : "") ||
    (state.submission.status === "conflict" ||
    state.submission.status === "failed"
      ? state.submission.message
      : "");
  const canSubmit =
    state.submission.status !== "submitting" &&
    state.submission.status !== "succeeded" &&
    submissionIssues.length === 0 &&
    preview !== null &&
    previewAllowsSubmission(state.draft, preview);

  const submit = useCallback(async (): Promise<BulkAssignmentSubmitOutcome> => {
    if (submittingRef.current) {
      return { conflict: false, message: genericErrorMessage, ok: false };
    }
    let current = stateRef.current;
    if (commonPlanRequired && !current.draft.commonPlan) {
      setMessage(commonPlanRequiredMessage);
      return {
        conflict: false,
        message: commonPlanRequiredMessage,
        ok: false,
      };
    }
    if (current.submission.status === "succeeded") {
      return { conflict: false, message: genericErrorMessage, ok: false };
    }
    const issues = validateBulkAssignmentSubmission(
      current.draft,
      clock(),
    );
    if (issues.length > 0) {
      setMessage(issues[0].message);
      return { conflict: false, message: issues[0].message, ok: false };
    }
    const previewFingerprint = bulkPreviewFingerprint(current.draft);
    const currentPreview =
      current.preview.status === "ready" &&
      current.preview.revision === current.revision &&
      current.preview.fingerprint === previewFingerprint
        ? current.preview.value
        : null;
    if (
      currentPreview === null ||
      !previewAllowsSubmission(current.draft, currentPreview)
    ) {
      setMessage(previewErrorMessage);
      setPreviewRefreshVersion((version) => version + 1);
      return { conflict: false, message: previewErrorMessage, ok: false };
    }
    if (current.submission.status !== "idle") {
      apply({ type: "submission/reset" });
      current = stateRef.current;
    }

    const fingerprint = bulkSubmissionFingerprint(current.draft);
    const reservation = reserveIdempotencyKey(
      idempotencyRef.current,
      fingerprint,
      () => crypto.randomUUID(),
    );
    idempotencyRef.current = reservation;
    const requestId = crypto.randomUUID();
    const request = buildBulkAssignmentRequest(
      current.draft,
      reservation.key,
      clock(),
    );
    submittingRef.current = true;
    setMessage("");
    apply({
      type: "submission/requested",
      revision: current.revision,
      requestId,
      fingerprint,
    });

    try {
      const response = await transport({
        body: request.body,
        method: request.method,
        url: request.endpoint,
      });
      if (!response.ok) {
        const responseMessage = assignmentTransportError(
          response.data,
          genericErrorMessage,
        );
        if (response.status === 409) {
          apply({
            type: "submission/conflicted",
            revision: current.revision,
            requestId,
            message: responseMessage,
          });
          setPreviewRefreshVersion((version) => version + 1);
          return { conflict: true, message: responseMessage, ok: false };
        }
        throw new Error(responseMessage);
      }
      let result: BulkAssignmentCreationResponse;
      try {
        result = parseBulkAssignmentCreationResponse(response.data);
      } catch {
        throw new Error(genericErrorMessage);
      }
      if (
        result.assignments.length !== currentPreview.assignmentCount
      ) {
        throw new Error(genericErrorMessage);
      }
      apply({
        type: "submission/succeeded",
        revision: current.revision,
        requestId,
        result,
      });
      return { ok: true, result };
    } catch (error: unknown) {
      const failureMessage =
        error instanceof Error ? error.message : genericErrorMessage;
      apply({
        type: "submission/failed",
        revision: current.revision,
        requestId,
        message: failureMessage,
      });
      return { conflict: false, message: failureMessage, ok: false };
    } finally {
      submittingRef.current = false;
    }
  }, [
    apply,
    clock,
    commonPlanRequired,
    commonPlanRequiredMessage,
    genericErrorMessage,
    previewErrorMessage,
    transport,
  ]);

  const changeCommonPlan = useCallback(
    (commonPlan: BulkSeriesAssignmentDraft["commonPlan"]) =>
      changeDraft({ type: "common_plan/changed", commonPlan }),
    [changeDraft],
  );

  const actions = {
    changeCommonPlan,
    changeDeadline: (deadline: AssignmentDeadline) =>
      changeDraft({ type: "deadline/changed", deadline }),
    changeDirection: (value: AssignmentDirectionRatio) =>
      changeDraft({ type: "exam/direction_changed", value }),
    changeFirstAvailableDate: (value: string) =>
      changeDraft({ type: "schedule/date_changed", value }),
    changeInterval: (value: number) =>
      changeDraft({ type: "schedule/interval_changed", value }),
    changeOrder: (value: AssignmentQuestionOrderMode) =>
      changeDraft({ type: "exam/order_changed", value }),
    changePassingScore: (value: number) =>
      changeDraft({ type: "exam/passing_score_changed", value }),
    changeRange: (range: BulkSeriesAssignmentDraft["range"]) =>
      changeDraft({ type: "range/changed", range }),
    changeReviewLevels: (levels: readonly ReviewLevel[]) =>
      changeDraft({ type: "review/levels_changed", levels }),
    changeTiming: (timing: ExamTiming) => {
      if (timing.mode === "total") {
        timingMemoryRef.current.totalSeconds = timing.totalSeconds;
      } else {
        timingMemoryRef.current.perQuestionSeconds =
          timing.perQuestionSeconds;
      }
      changeDraft({ type: "exam/timing_changed", timing });
    },
    changeTimeLimitEnabled: (enabled: boolean) => changeDraft({ type: "exam/time_limit_changed", enabled }),
    changeTimingMode: (mode: ExamTiming["mode"]) => {
      changeDraft({
        type: "exam/timing_changed",
        timing:
          mode === "total"
            ? {
                mode,
                totalSeconds: timingMemoryRef.current.totalSeconds,
              }
            : {
                mode,
                perQuestionSeconds:
                  timingMemoryRef.current.perQuestionSeconds,
              },
      });
    },
    refreshPreview: () =>
      setPreviewRefreshVersion((version) => version + 1),
    submit,
  };

  return {
    actions,
    canSubmit,
    message: displayedMessage,
    preview,
    previewLoading,
    state,
    submissionIssues,
  };
}

export type BulkAssignmentController = ReturnType<typeof useBulkAssignmentController>;
