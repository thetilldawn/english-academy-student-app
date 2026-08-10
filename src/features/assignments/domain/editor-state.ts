import type { AssignmentDraft } from "./model";
import { reduceSingleAssignmentDraft } from "./single-draft";

export type SingleCapacityReconciliation = {
  kind: "single_capacity";
  minimumQuestionCount: number;
  maximumQuestionCount: number;
  recommendedQuestionCount: number;
  minimumAllowedQuestionCount: number;
};

export type PreviewState<Preview> =
  | { status: "idle" }
  | {
      status: "loading";
      revision: number;
      requestId: string;
      fingerprint: string;
    }
  | {
      status: "ready";
      revision: number;
      requestId: string;
      fingerprint: string;
      value: Preview;
    }
  | {
      status: "error";
      revision: number;
      requestId: string;
      fingerprint: string;
      message: string;
    };

export type SubmissionState<Result> =
  | { status: "idle" }
  | {
      status: "submitting";
      revision: number;
      requestId: string;
      fingerprint: string;
    }
  | { status: "succeeded"; revision: number; requestId: string; result: Result }
  | { status: "conflict"; revision: number; requestId: string; message: string }
  | { status: "failed"; revision: number; requestId: string; message: string };

export type AssignmentEditorState<
  Draft extends AssignmentDraft,
  Preview,
  Result,
> = {
  draft: Draft;
  revision: number;
  preview: PreviewState<Preview>;
  submission: SubmissionState<Result>;
};

export type AssignmentEditorAction<
  Draft extends AssignmentDraft,
  Preview,
  Result,
> =
  | { type: "draft/replaced"; draft: Draft }
  | {
      type: "preview/requested";
      revision: number;
      requestId: string;
      fingerprint: string;
    }
  | {
      type: "preview/succeeded";
      revision: number;
      requestId: string;
      fingerprint: string;
      value: Preview;
    }
  | {
      type: "preview/reconciled";
      revision: number;
      requestId: string;
      fingerprint: string;
      value: Preview;
      reconciliation: SingleCapacityReconciliation;
    }
  | {
      type: "preview/failed";
      revision: number;
      requestId: string;
      fingerprint: string;
      message: string;
    }
  | {
      type: "submission/requested";
      revision: number;
      requestId: string;
      fingerprint: string;
    }
  | { type: "submission/succeeded"; revision: number; requestId: string; result: Result }
  | { type: "submission/conflicted"; revision: number; requestId: string; message: string }
  | { type: "submission/failed"; revision: number; requestId: string; message: string }
  | { type: "submission/reset" };

function reconcileDraftFromCapacity<Draft extends AssignmentDraft>(
  draft: Draft,
  reconciliation: SingleCapacityReconciliation,
): Draft {
  if (draft.kind !== "single") return draft;
  return reduceSingleAssignmentDraft(draft, {
    type: "capacity/reconciled",
    minimumQuestionCount: reconciliation.minimumQuestionCount,
    maximumQuestionCount: reconciliation.maximumQuestionCount,
    recommendedQuestionCount: reconciliation.recommendedQuestionCount,
    minimumAllowedQuestionCount:
      reconciliation.minimumAllowedQuestionCount,
  }) as Draft;
}

export function createAssignmentEditorState<
  Draft extends AssignmentDraft,
  Preview,
  Result,
>(draft: Draft): AssignmentEditorState<Draft, Preview, Result> {
  return {
    draft,
    revision: 0,
    preview: { status: "idle" },
    submission: { status: "idle" },
  };
}

export function reduceAssignmentEditorState<
  Draft extends AssignmentDraft,
  Preview,
  Result,
>(
  state: AssignmentEditorState<Draft, Preview, Result>,
  action: AssignmentEditorAction<Draft, Preview, Result>,
): AssignmentEditorState<Draft, Preview, Result> {
  if (action.type === "draft/replaced") {
    if (state.submission.status === "submitting") return state;
    return {
      draft: action.draft,
      revision: state.revision + 1,
      preview: { status: "idle" },
      submission: { status: "idle" },
    };
  }
  if (action.type === "preview/requested") {
    if (
      action.revision !== state.revision ||
      state.submission.status === "submitting"
    ) {
      return state;
    }
    return {
      ...state,
      preview: {
        status: "loading",
        revision: action.revision,
        requestId: action.requestId,
        fingerprint: action.fingerprint,
      },
    };
  }
  if (
    action.type === "preview/succeeded" ||
    action.type === "preview/reconciled" ||
    action.type === "preview/failed"
  ) {
    if (
      state.submission.status === "submitting" ||
      state.preview.status !== "loading" ||
      action.revision !== state.revision ||
      state.preview.revision !== action.revision ||
      state.preview.requestId !== action.requestId ||
      state.preview.fingerprint !== action.fingerprint
    ) {
      return state;
    }
    if (action.type === "preview/reconciled") {
      const reconciledDraft = reconcileDraftFromCapacity(
        state.draft,
        action.reconciliation,
      );
      const nextRevision =
        reconciledDraft === state.draft ? state.revision : state.revision + 1;
      return {
        ...state,
        draft: reconciledDraft,
        revision: nextRevision,
        preview: {
          status: "ready",
          revision: nextRevision,
          requestId: action.requestId,
          fingerprint: action.fingerprint,
          value: action.value,
        },
      };
    }
    return {
      ...state,
      preview:
        action.type === "preview/succeeded"
          ? {
              status: "ready",
              revision: action.revision,
              requestId: action.requestId,
              fingerprint: action.fingerprint,
              value: action.value,
            }
          : {
              status: "error",
              revision: action.revision,
              requestId: action.requestId,
              fingerprint: action.fingerprint,
              message: action.message,
            },
    };
  }
  if (action.type === "submission/requested") {
    if (
      action.revision !== state.revision ||
      state.submission.status !== "idle" ||
      state.preview.status !== "ready" ||
      state.preview.revision !== state.revision
    ) {
      return state;
    }
    return {
      ...state,
      submission: {
        status: "submitting",
        revision: action.revision,
        requestId: action.requestId,
        fingerprint: action.fingerprint,
      },
    };
  }
  if (action.type === "submission/reset") {
    if (state.submission.status === "submitting") return state;
    return { ...state, submission: { status: "idle" } };
  }
  if (
    state.submission.status !== "submitting" ||
    action.revision !== state.revision ||
    state.submission.revision !== action.revision ||
    state.submission.requestId !== action.requestId
  ) {
    return state;
  }
  if (action.type === "submission/succeeded") {
    return {
      ...state,
      submission: {
        status: "succeeded",
        revision: action.revision,
        requestId: action.requestId,
        result: action.result,
      },
    };
  }
  if (action.type === "submission/conflicted") {
    return {
      ...state,
      preview: { status: "idle" },
      submission: {
        status: "conflict",
        revision: action.revision,
        requestId: action.requestId,
        message: action.message,
      },
    };
  }
  return {
    ...state,
    submission: {
      status: "failed",
      revision: action.revision,
      requestId: action.requestId,
      message: action.message,
    },
  };
}
