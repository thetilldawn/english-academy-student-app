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
  type AssignmentCapacityResponse,
} from "../api/response-adapters";
import type { SingleAssignmentResult } from "../contracts/single-assignment-editor-contract";
import {
  loadSingleAssignmentEditDraft,
  prepareSingleAssignmentSubmission,
  resolveSingleAssignmentIssues,
  resolveSingleAssignmentSubmitBlocker,
  singleCapacityIdentity,
  singleReplacementIsDirty,
  singleSubmissionProgressIdentity,
} from "../application/assignment-edit-flow-adapter";
import type { AssignmentOperationRecovery } from "../application/assignment-operation-error";
import {
  createAssignmentSubmissionFlow,
} from "../application/submission-flow";
import {
  createAssignmentEditorState,
  reduceAssignmentEditorState,
  type AssignmentEditorAction,
  type AssignmentEditorState,
} from "../domain/editor-state";
import type {
  AssignmentDeadline,
  SingleAssignmentDraft,
} from "../domain/model";
import { singleAssignmentFieldPolicy } from "../domain/assignment-edit-policy";
import {
  reduceSingleAssignmentDraft,
  resolveSingleAssignmentDraft,
  type SingleAssignmentDraftAction,
} from "../domain/single-draft";
import {
  browserAssignmentTransport,
  type AssignmentTransport,
} from "../transport/assignment-transport";
import {
  reduceSingleAssignmentTimingMemory,
  useSingleAssignmentControllerActions,
} from "./single-assignment-controller-actions";
import {
  useAssignmentMinuteClock,
  useAssignmentSubmissionSession,
} from "./use-assignment-controller-runtime";
import { useAssignmentPreview } from "./use-assignment-preview";

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

type AssignmentFeedback = {
  message: string;
  submissionIssue: { message: string; path: string } | null;
};

export type AssignmentControllerSource =
  | { kind: "create"; initialDraft: SingleAssignmentDraft }
  | {
      assignmentId: string;
      fallbackDraft: SingleAssignmentDraft;
      initialDraft?: SingleAssignmentDraft;
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
    availability: { mode: "immediate" },
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

function isMixedReviewEdit(draft: SingleAssignmentDraft) {
  return (
    draft.operation.mode === "replace" &&
    draft.operation.sourcePurpose === "mixed"
  );
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
    source.kind === "create"
      ? source.initialDraft
      : source.initialDraft ?? source.fallbackDraft;
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
    useState<SingleAssignmentDraft | null>(
      source.kind === "edit" ? source.initialDraft ?? null : null,
    );
  const [loadStatus, setLoadStatus] = useState<
    "loading" | "ready" | "error"
  >(
    source.kind === "edit" && !source.initialDraft ? "loading" : "ready",
  );
  const [feedback, setFeedback] = useState<AssignmentFeedback>({
    message: "",
    submissionIssue: null,
  });
  const [previewRefreshVersion, setPreviewRefreshVersion] = useState(0);
  const [sourceReloadVersion, setSourceReloadVersion] = useState(0);
  const nowMilliseconds = useAssignmentMinuteClock({
    clock,
    initializeFromClock: false,
  });
  const submissionSession = useAssignmentSubmissionSession();
  const [timingMemory, rememberTiming] = useReducer(
    reduceSingleAssignmentTimingMemory,
    {
      perQuestionSeconds:
        initialDraft.exam.timing.mode === "per_question"
          ? initialDraft.exam.timing.perQuestionSeconds
          : 20,
      totalSeconds:
        initialDraft.exam.timing.mode === "total"
          ? initialDraft.exam.timing.totalSeconds
          : 300,
    },
  );
  const sourceKind = source.kind;
  const sourceAssignmentId =
    source.kind === "edit" ? source.assignmentId : null;
  const sourceStudentId = source.kind === "edit" ? source.studentId : null;
  const hasInitialEditDraft = source.kind === "edit" && Boolean(source.initialDraft);
  const submissionFlow = useMemo(
    () =>
      createAssignmentSubmissionFlow({
        busyMessage: "배정을 저장하고 있습니다.",
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

  const setMessage = useCallback((message: string) => {
    setFeedback((current) =>
      current.message === message ? current : { ...current, message },
    );
  }, []);
  const setSubmissionIssue = useCallback(
    (submissionIssue: AssignmentFeedback["submissionIssue"]) => {
      setFeedback((current) =>
        current.submissionIssue === submissionIssue
          ? current
          : { ...current, submissionIssue },
      );
    },
    [],
  );

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
    if (hasInitialEditDraft && sourceReloadVersion === 0) return;
    const abortController = new AbortController();
    void loadSingleAssignmentEditDraft({
      assignmentId: sourceAssignmentId,
      fallback: editLoadErrorMessage,
      signal: abortController.signal,
      studentId: sourceStudentId,
      transport,
    }).then((result) => {
        if (!result.ok) throw result.error;
        const hydrated = result.value;
        rememberTiming(hydrated.exam.timing);
        setBaselineDraft(hydrated);
        setSubmissionIssue(null);
        setMessage("");
        apply({ type: "draft/replaced", draft: hydrated });
        setLoadStatus("ready");
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) return;
        setMessage(
          error && typeof error === "object" && "message" in error &&
              typeof error.message === "string"
            ? error.message
            : editLoadErrorMessage,
        );
        setLoadStatus("error");
      });
    return () => abortController.abort();
  }, [
    apply,
    editLoadErrorMessage,
    hasInitialEditDraft,
    rememberTiming,
    setMessage,
    setSubmissionIssue,
    sourceAssignmentId,
    sourceKind,
    sourceReloadVersion,
    sourceStudentId,
    transport,
  ]);

  const reloadSource = useCallback(() => {
    if (sourceKind === "edit") {
      setLoadStatus("loading");
      setSourceReloadVersion((version) => version + 1);
    }
  }, [sourceKind]);

  const recoverPreview = useCallback(
    (recovery: AssignmentOperationRecovery) => {
      if (recovery === "reload_source") {
        reloadSource();
      } else if (recovery === "refresh_preview") {
        setPreviewRefreshVersion((version) => version + 1);
      }
    },
    [reloadSource],
  );

  useAssignmentPreview({
    apply,
    delayMs: previewDelayMs,
    enabled: loadStatus === "ready",
    errorMessage: capacityErrorMessage,
    onRecovery: recoverPreview,
    refreshVersion: previewRefreshVersion,
    state,
    transport,
  });

  const changeDraft = useCallback(
    (action: SingleAssignmentDraftAction) => {
      const currentDraft = stateRef.current.draft;
      const nextDraft = reduceSingleAssignmentDraft(currentDraft, action);
      if (nextDraft === currentDraft) return;
      const currentCapacityFingerprint = singleCapacityIdentity(currentDraft);
      const nextCapacityFingerprint = singleCapacityIdentity(nextDraft);
      setMessage("");
      setSubmissionIssue(null);
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
    [apply, setMessage, setSubmissionIssue],
  );

  const capacity = state.preview.status === "ready" ? state.preview.value : null;
  const automaticTitle = automaticTitleForDraft(state.draft, capacity);
  const fieldPolicy = singleAssignmentFieldPolicy(state.draft);
  const resolved = resolveSingleAssignmentDraft(state.draft, {
    title: automaticTitle,
  });
  const minimumQuestionCount = isExactReviewEdit(state.draft) ? 1 : 4;
  const issues = [
    ...resolveSingleAssignmentIssues(
      state.draft,
      resolved,
      nowMilliseconds,
    ),
    ...(feedback.submissionIssue
      ? [{
          code: "invalid_order" as const,
          message: feedback.submissionIssue.message,
          path: feedback.submissionIssue.path,
        }]
      : []),
  ];
  const baselineResolved = baselineDraft
    ? resolveSingleAssignmentDraft(baselineDraft, {
        title: automaticTitleForDraft(baselineDraft, capacity),
      })
    : null;
  const dirty = baselineDraft && baselineResolved
    ? singleReplacementIsDirty(
        state.draft,
        resolved,
        baselineDraft,
        baselineResolved,
      )
    : true;
  const capacityReadyForCurrentDraft =
    state.preview.status === "ready" &&
    state.preview.revision === state.revision;
  const submitBlocker = resolveSingleAssignmentSubmitBlocker({
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
    if (current.submission.status === "succeeded") {
      return { conflict: false, message: genericErrorMessage, ok: false };
    }
    const currentCapacity =
      current.preview.status === "ready" ? current.preview.value : null;
    const currentResolved = resolveSingleAssignmentDraft(current.draft, {
      title: automaticTitleForDraft(current.draft, currentCapacity),
    });
    const currentMinimumQuestionCount = isExactReviewEdit(current.draft)
      ? 1
      : 4;
    const currentIssues = resolveSingleAssignmentIssues(
      current.draft,
      currentResolved,
      nowMilliseconds,
    );
    const baselineResolvedForSubmit = baselineDraft
      ? resolveSingleAssignmentDraft(baselineDraft, {
          title: automaticTitleForDraft(baselineDraft, currentCapacity),
        })
      : null;
    const currentDirty = baselineDraft && baselineResolvedForSubmit
      ? singleReplacementIsDirty(
          current.draft,
          currentResolved,
          baselineDraft,
          baselineResolvedForSubmit,
        )
      : true;
    const runSubmission = () =>
      submissionFlow.run((now) =>
        prepareSingleAssignmentSubmission(
          {
            draft: current.draft,
            fallback: genericErrorMessage,
            resolved: currentResolved,
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
    const currentBlocker = resolveSingleAssignmentSubmitBlocker({
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
      submissionStatus: "idle",
    });
    if (currentBlocker) {
      setMessage(capacityErrorMessage);
      return {
        conflict: false,
        message: capacityErrorMessage,
        ok: false,
      };
    }
    if (current.submission.status !== "idle") {
      apply({ type: "submission/reset" });
      current = stateRef.current;
    }

    const requestId = crypto.randomUUID();
    const fingerprint = singleSubmissionProgressIdentity(
      current.draft,
      currentResolved,
    );
    if (!fingerprint) {
      setMessage(genericErrorMessage);
      return { conflict: false, message: genericErrorMessage, ok: false };
    }
    const revision = current.revision;
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
    setSubmissionIssue(null);

    const outcome = await runSubmission();
    if (outcome.ok) {
      apply({
        type: "submission/succeeded",
        requestId,
        result: outcome.value,
        revision,
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
    if (outcome.error.fieldPath) {
      setSubmissionIssue({
        message: outcome.error.message,
        path: outcome.error.fieldPath,
      });
    }
    if (outcome.error.kind === "conflict") {
      apply({
        type: "submission/conflicted",
        message: outcome.error.message,
        requestId,
        revision,
      });
      apply({ type: "submission/reset" });
      if (outcome.error.recovery === "reload_source") {
        reloadSource();
      } else if (outcome.error.recovery === "refresh_preview") {
        setPreviewRefreshVersion((version) => version + 1);
      }
      onConflict?.();
    } else {
      apply({
        type: "submission/failed",
        message: outcome.error.message,
        requestId,
        revision,
      });
      apply({ type: "submission/reset" });
    }
    setMessage(outcome.error.message);
    return {
      conflict: outcome.error.kind === "conflict",
      message: outcome.error.message,
      ok: false,
    };
  }, [
    apply,
    automaticTitleForDraft,
    baselineDraft,
    capacityErrorMessage,
    genericErrorMessage,
    loadStatus,
    nowMilliseconds,
    onConflict,
    reloadSource,
    setMessage,
    setSubmissionIssue,
    submissionFlow,
  ]);

  const retryPreview = useCallback(() => {
    setPreviewRefreshVersion((version) => version + 1);
  }, []);
  const actions = useSingleAssignmentControllerActions({
    changeDraft,
    currentState: stateRef,
    rememberTiming,
    retryPreview,
    submit,
    timingMemory,
  });

  return {
    actions,
    automaticTitle,
    baselineDraft,
    canSubmit,
    capacity,
    dirty,
    fieldPolicy,
    isExactReview: isExactReviewEdit(state.draft),
    isMixedReview: isMixedReviewEdit(state.draft),
    issues,
    loadStatus,
    message: feedback.message,
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
