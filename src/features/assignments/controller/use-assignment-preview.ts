"use client";

import { useCallback, useMemo, useRef } from "react";

import {
  prepareSingleAssignmentPreview,
} from "../application/assignment-edit-flow-adapter";
import type {
  AssignmentOperationError,
  AssignmentOperationRecovery,
} from "../application/assignment-operation-error";
import type { AssignmentRequestIdentity } from "../application/request-lifecycle";
import type {
  AssignmentEditorAction,
  AssignmentEditorState,
} from "../domain/editor-state";
import type { SingleAssignmentDraft } from "../domain/model";
import type {
  AssignmentCapacityResponse,
} from "../api/response-adapters";
import type { AssignmentTransport } from "../transport/assignment-transport";
import { useDebouncedAssignmentPreview } from "./use-debounced-assignment-preview";

type SingleEditorState<Result> = AssignmentEditorState<
  SingleAssignmentDraft,
  AssignmentCapacityResponse,
  Result
>;

type SingleEditorAction<Result> = AssignmentEditorAction<
  SingleAssignmentDraft,
  AssignmentCapacityResponse,
  Result
>;

export function useAssignmentPreview<Result>({
  apply,
  delayMs = 120,
  enabled,
  errorMessage,
  onRecovery,
  refreshVersion,
  state,
  transport,
}: {
  apply: (action: SingleEditorAction<Result>) => void;
  delayMs?: number;
  enabled: boolean;
  errorMessage: string;
  onRecovery?: (recovery: AssignmentOperationRecovery) => void;
  refreshVersion: number;
  state: SingleEditorState<Result>;
  transport: AssignmentTransport;
}) {
  const recoveredFingerprintRef = useRef<string | null>(null);
  const directionRatio = state.draft.exam.directionRatio;
  const operation = state.draft.operation;
  const range = state.draft.range;
  const review = state.draft.review;
  const studentId = state.draft.studentId;
  const projection = useMemo(
    () =>
      prepareSingleAssignmentPreview(
        { directionRatio, operation, range, review, studentId },
        errorMessage,
      ),
    [directionRatio, errorMessage, operation, range, review, studentId],
  );
  const handleRequested = useCallback(
    (identity: AssignmentRequestIdentity) => {
      apply({
        type: "preview/requested",
        fingerprint: identity.fingerprint,
        requestId: identity.requestId,
        revision: identity.revision,
      });
    },
    [apply],
  );
  const handleSucceeded = useCallback(
    (value: AssignmentCapacityResponse, identity: AssignmentRequestIdentity) => {
      if (!projection) return;
      recoveredFingerprintRef.current = null;
      apply({
        type: "preview/reconciled",
        fingerprint: identity.fingerprint,
        reconciliation: {
          kind: "single_capacity",
          maximumQuestionCount: value.maximumQuestionCount,
          minimumAllowedQuestionCount:
            projection.minimumAllowedQuestionCount,
          minimumQuestionCount: value.minimumQuestionCount,
          recommendedQuestionCount: value.recommendedQuestionCount,
        },
        requestId: identity.requestId,
        revision: identity.revision,
        value,
      });
    },
    [apply, projection],
  );
  const handleFailed = useCallback(
    (error: AssignmentOperationError, identity: AssignmentRequestIdentity) => {
      if (
        (error.recovery === "reload_source" ||
          error.recovery === "refresh_preview") &&
        onRecovery &&
        recoveredFingerprintRef.current !== identity.fingerprint
      ) {
        recoveredFingerprintRef.current = identity.fingerprint;
        onRecovery(error.recovery);
        return;
      }
      apply({
        type: "preview/failed",
        fingerprint: identity.fingerprint,
        message: error.message,
        requestId: identity.requestId,
        revision: identity.revision,
      });
    },
    [apply, onRecovery],
  );

  useDebouncedAssignmentPreview({
    delayMs,
    enabled: enabled && state.submission.status !== "submitting",
    onFailed: handleFailed,
    onRequested: handleRequested,
    onSucceeded: handleSucceeded,
    preparation: projection?.preparation ?? null,
    refreshVersion,
    revision: state.revision,
    transport,
  });
}
