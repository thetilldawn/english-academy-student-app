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
  type BulkAssignmentCreationResponse,
  type BulkAssignmentPreviewResponse,
} from "../api/response-adapters";
import {
  bulkPreviewAllowsSubmission,
  bulkPreviewIdentity,
  bulkSubmissionIdentity,
  prepareBulkAssignmentPreview,
  prepareBulkAssignmentSubmission,
  resolveBulkPreviewIssues,
  resolveBulkSubmissionIssues,
} from "../application/bulk-assignment-flow-adapter";
import type { AssignmentOperationError } from "../application/assignment-operation-error";
import type { AssignmentRequestIdentity } from "../application/request-lifecycle";
import {
  createAssignmentSubmissionFlow,
} from "../application/submission-flow";
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
import type {
  AssignmentDirectionRatio,
  AssignmentQuestionOrderMode,
  BulkSeriesAssignmentDraft,
  ExamTiming,
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

type BulkAssignmentFeedback = {
  message: string;
  submissionIssue:
    | ReturnType<typeof resolveBulkSubmissionIssues>[number]
    | null;
};

export type BulkAssignmentSubmitOutcome =
  | { ok: true; result: BulkAssignmentCreationResponse }
  | { conflict: boolean; message: string; ok: false };

const systemClock = () => Date.now();

export function useBulkAssignmentController({
  enabled = true,
  genericErrorMessage,
  initialCommonPlan,
  previewDelayMs = 120,
  previewErrorMessage,
  studentIds,
  clock = systemClock,
  transport = browserAssignmentTransport,
}: {
  enabled?: boolean;
  genericErrorMessage: string;
  initialCommonPlan?: BulkSeriesAssignmentDraft["commonPlan"];
  previewDelayMs?: number;
  previewErrorMessage: string;
  studentIds: readonly string[];
  clock?: () => number;
  transport?: AssignmentTransport;
}) {
  const [initialDraft] = useState(() =>
    createInitialBulkSeriesAssignmentDraft({
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
  const [feedback, setFeedback] = useState<BulkAssignmentFeedback>({
    message: "",
    submissionIssue: null,
  });
  const [previewRefreshVersion, setPreviewRefreshVersion] = useState(0);
  const [handledRefreshVersion, setHandledRefreshVersion] = useState(0);
  const nowMilliseconds = useAssignmentMinuteClock({
    clock,
    initializeFromClock: true,
  });
  const submissionSession = useAssignmentSubmissionSession();
  const timingMemoryRef = useRef({
    perQuestionSeconds: 20,
    totalSeconds: 300,
  });
  const previewRecoveryFingerprintRef = useRef<string | null>(null);

  const setMessage = useCallback((message: string) => {
    setFeedback((current) => ({ ...current, message }));
  }, []);
  const setSubmissionIssue = useCallback(
    (
      submissionIssue:
        | ReturnType<typeof resolveBulkSubmissionIssues>[number]
        | null,
    ) => {
      setFeedback((current) => ({ ...current, submissionIssue }));
    },
    [],
  );

  const submissionFlow = useMemo(
    () =>
      createAssignmentSubmissionFlow({
        busyMessage: "일괄 배정을 저장하고 있습니다.",
        clock,
        createIdempotencyKey: () => crypto.randomUUID(),
        createRequestId: () => crypto.randomUUID(),
        fallback: genericErrorMessage,
        session: submissionSession,
        transport,
      }),
    [clock, genericErrorMessage, submissionSession, transport],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
      const currentFingerprint = bulkPreviewIdentity(currentDraft);
      const nextFingerprint = bulkPreviewIdentity(nextDraft);
      setFeedback({ message: "", submissionIssue: null });
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

  const previewIssues = resolveBulkPreviewIssues(state.draft);
  const currentSubmissionIssues = resolveBulkSubmissionIssues(
    state.draft,
    nowMilliseconds,
  );
  const submissionIssues = feedback.submissionIssue
    ? [
        feedback.submissionIssue,
        ...currentSubmissionIssues.filter(
          (issue) => issue.path !== feedback.submissionIssue?.path,
        ),
      ]
    : currentSubmissionIssues;
  const previewPreparation = useMemo(
    () =>
      previewIssues.length === 0
        ? prepareBulkAssignmentPreview(state.draft, previewErrorMessage)
        : null,
    [previewErrorMessage, previewIssues.length, state.draft],
  );
  const currentPreviewFingerprint = previewPreparation?.fingerprint ?? null;
  const preview =
    state.preview.status === "ready" &&
    state.preview.revision === state.revision &&
    state.preview.fingerprint === currentPreviewFingerprint
      ? state.preview.value
      : null;
  const forcePreviewRefresh = handledRefreshVersion !== previewRefreshVersion;
  const previewAlreadyCurrent =
    state.preview.status === "ready" &&
    state.preview.revision === state.revision &&
    state.preview.fingerprint === currentPreviewFingerprint;
  const handlePreviewRequested = useCallback(
    (identity: AssignmentRequestIdentity) => {
      setHandledRefreshVersion(previewRefreshVersion);
      apply({
        type: "preview/requested",
        revision: identity.revision,
        requestId: identity.requestId,
        fingerprint: identity.fingerprint,
      });
    },
    [apply, previewRefreshVersion],
  );
  const handlePreviewSucceeded = useCallback(
    (
      value: BulkAssignmentPreviewResponse,
      identity: AssignmentRequestIdentity,
    ) => {
      previewRecoveryFingerprintRef.current = null;
      apply({
        type: "preview/succeeded",
        revision: identity.revision,
        requestId: identity.requestId,
        fingerprint: identity.fingerprint,
        value,
      });
    },
    [apply],
  );
  const handlePreviewFailed = useCallback(
    (
      error: AssignmentOperationError,
      identity: AssignmentRequestIdentity,
    ) => {
      if (
        error.recovery === "refresh_preview" &&
        previewRecoveryFingerprintRef.current !== identity.fingerprint
      ) {
        previewRecoveryFingerprintRef.current = identity.fingerprint;
        setPreviewRefreshVersion((version) => version + 1);
        return;
      }
      apply({
        type: "preview/failed",
        revision: identity.revision,
        requestId: identity.requestId,
        fingerprint: identity.fingerprint,
        message: error.message,
      });
    },
    [apply],
  );
  useDebouncedAssignmentPreview({
    delayMs: previewDelayMs,
    enabled:
      enabled &&
      previewPreparation !== null &&
      state.submission.status !== "submitting" &&
      (forcePreviewRefresh || !previewAlreadyCurrent),
    onFailed: handlePreviewFailed,
    onRequested: handlePreviewRequested,
    onSucceeded: handlePreviewSucceeded,
    preparation: previewPreparation,
    refreshVersion: previewRefreshVersion,
    revision: state.revision,
    transport,
  });

  const previewLoading =
    previewIssues.length === 0 &&
    (state.preview.status === "idle" || state.preview.status === "loading");
  const displayedMessage =
    feedback.message ||
    previewIssues[0]?.message ||
    (state.preview.status === "error" ? state.preview.message : "") ||
    (state.submission.status === "conflict" ||
    state.submission.status === "failed"
      ? state.submission.message
      : "");
  const canSubmit =
    enabled &&
    state.submission.status !== "submitting" &&
    state.submission.status !== "succeeded" &&
    submissionIssues.length === 0 &&
    preview !== null &&
    bulkPreviewAllowsSubmission(state.draft, preview);

  const submit = useCallback(async (): Promise<BulkAssignmentSubmitOutcome> => {
    let current = stateRef.current;
    if (current.submission.status === "succeeded") {
      return { conflict: false, message: genericErrorMessage, ok: false };
    }
    const issues = resolveBulkSubmissionIssues(
      current.draft,
      nowMilliseconds,
    );
    if (issues.length > 0 && current.submission.status !== "submitting") {
      setMessage(issues[0].message);
      setSubmissionIssue(issues[0]);
      return { conflict: false, message: issues[0].message, ok: false };
    }
    const previewFingerprint = bulkPreviewIdentity(current.draft);
    const currentPreview =
      current.preview.status === "ready" &&
      current.preview.revision === current.revision &&
      current.preview.fingerprint === previewFingerprint
        ? current.preview.value
        : null;
    if (
      currentPreview === null ||
      previewFingerprint === null ||
      !bulkPreviewAllowsSubmission(current.draft, currentPreview)
    ) {
      setMessage(previewErrorMessage);
      setPreviewRefreshVersion((version) => version + 1);
      return { conflict: false, message: previewErrorMessage, ok: false };
    }
    const runSubmission = () =>
      submissionFlow.run((now) =>
        prepareBulkAssignmentSubmission(
          {
            draft: current.draft,
            preview: currentPreview,
            previewFallback: previewErrorMessage,
            previewFingerprint,
            submissionFallback: genericErrorMessage,
          },
          now,
        )
      );
    if (current.submission.status === "submitting") {
      const duplicate = await runSubmission();
      return duplicate.ok
        ? { ok: true, result: duplicate.value }
        : {
            conflict: duplicate.error.kind === "conflict",
            message: duplicate.error.message,
            ok: false,
          };
    }
    if (current.submission.status !== "idle") {
      apply({ type: "submission/reset" });
      current = stateRef.current;
    }

    const fingerprint = bulkSubmissionIdentity(current.draft, currentPreview);
    if (!fingerprint) {
      setMessage(previewErrorMessage);
      setPreviewRefreshVersion((version) => version + 1);
      return { conflict: false, message: previewErrorMessage, ok: false };
    }
    const requestId = crypto.randomUUID();
    setMessage("");
    setSubmissionIssue(null);
    apply({
      type: "submission/requested",
      revision: current.revision,
      requestId,
      fingerprint,
    });

    const outcome = await runSubmission();
    if (outcome.ok) {
      apply({
        type: "submission/succeeded",
        revision: current.revision,
        requestId,
        result: outcome.value,
      });
      return { ok: true, result: outcome.value };
    }
    if (outcome.error.kind === "busy") {
      return {
        conflict: false,
        message: outcome.error.message,
        ok: false,
      };
    }
    setSubmissionIssue(
      outcome.error.fieldPath
        ? {
            code: "invalid_order",
            message: outcome.error.message,
            path: outcome.error.fieldPath,
          }
        : null,
    );
    if (outcome.error.kind === "conflict") {
      apply({
        type: "submission/conflicted",
        revision: current.revision,
        requestId,
        message: outcome.error.message,
      });
      if (outcome.error.recovery === "refresh_preview") {
        setPreviewRefreshVersion((version) => version + 1);
      }
    } else {
      apply({
        type: "submission/failed",
        revision: current.revision,
        requestId,
        message: outcome.error.message,
      });
    }
    return {
      conflict: outcome.error.kind === "conflict",
      message: outcome.error.message,
      ok: false,
    };
  }, [
    apply,
    genericErrorMessage,
    nowMilliseconds,
    previewErrorMessage,
    setMessage,
    setSubmissionIssue,
    submissionFlow,
  ]);

  const changeCommonPlan = useCallback(
    (commonPlan: BulkSeriesAssignmentDraft["commonPlan"]) =>
      changeDraft({ type: "common_plan/changed", commonPlan }),
    [changeDraft],
  );

  const actions = {
    changeCommonPlan,
    changeDirection: (value: AssignmentDirectionRatio) =>
      changeDraft({ type: "exam/direction_changed", value }),
    changeOrder: (value: AssignmentQuestionOrderMode) =>
      changeDraft({ type: "exam/order_changed", value }),
    changePassingScore: (value: number) =>
      changeDraft({ type: "exam/passing_score_changed", value }),
    changeRetryEnabled: (enabled: boolean) =>
      changeDraft({ type: "exam/retry_enabled_changed", enabled }),
    changeRetryPassingScore: (value: number) =>
      changeDraft({ type: "exam/retry_passing_score_changed", value }),
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
