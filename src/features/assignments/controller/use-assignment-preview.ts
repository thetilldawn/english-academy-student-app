"use client";

import { useEffect, useMemo } from "react";

import {
  assignmentCapacityFingerprint,
  buildAssignmentCapacityRequest,
} from "../api/request-adapters";
import {
  parseAssignmentCapacityResponse,
  type AssignmentCapacityResponse,
} from "../api/response-adapters";
import type {
  AssignmentEditorAction,
  AssignmentEditorState,
} from "../domain/editor-state";
import type { SingleAssignmentDraft } from "../domain/model";
import {
  assignmentTransportError,
  type AssignmentTransport,
} from "../transport/assignment-transport";

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

function capacityProjectionDraft({
  directionRatio,
  operation,
  range,
  review,
  studentId,
}: Pick<SingleAssignmentDraft, "operation" | "range" | "review" | "studentId"> & {
  directionRatio: SingleAssignmentDraft["exam"]["directionRatio"];
}): SingleAssignmentDraft {
  return {
    deadline: { mode: "none" },
    exam: {
      directionRatio,
      passingScore: 0,
      questionOrderMode: "random",
      timing: { mode: "total", totalSeconds: 30 },
    },
    kind: "single",
    operation,
    questionCount: { mode: "automatic", value: 4 },
    range,
    review,
    studentId,
    title: { mode: "automatic" },
  };
}

export function useAssignmentPreview<Result>({
  apply,
  delayMs = 120,
  enabled,
  errorMessage,
  refreshVersion,
  state,
  transport,
}: {
  apply: (action: SingleEditorAction<Result>) => void;
  delayMs?: number;
  enabled: boolean;
  errorMessage: string;
  refreshVersion: number;
  state: SingleEditorState<Result>;
  transport: AssignmentTransport;
}) {
  const { draft, revision, submission } = state;
  const directionRatio = draft.exam.directionRatio;
  const operation = draft.operation;
  const range = draft.range;
  const review = draft.review;
  const studentId = draft.studentId;
  const projection = useMemo(() => {
    try {
      const projectedDraft = capacityProjectionDraft({
        directionRatio,
        operation,
        range,
        review,
        studentId,
      });
      return {
        fingerprint: assignmentCapacityFingerprint(projectedDraft),
        minimumAllowedQuestionCount:
          operation.mode === "replace" &&
          operation.sourcePurpose === "review"
            ? 1
            : 4,
        request: buildAssignmentCapacityRequest(projectedDraft),
      };
    } catch {
      return null;
    }
  }, [
    directionRatio,
    operation,
    range,
    review,
    studentId,
  ]);

  useEffect(() => {
    if (!enabled || !projection || submission.status === "submitting") return;

    const { fingerprint, minimumAllowedQuestionCount, request } = projection;
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      const requestId = crypto.randomUUID();
      apply({
        type: "preview/requested",
        fingerprint,
        requestId,
        revision,
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
              assignmentTransportError(response.data, errorMessage),
            );
          }
          const value = parseAssignmentCapacityResponse(response.data);
          apply({
            type: "preview/reconciled",
            fingerprint,
            reconciliation: {
              kind: "single_capacity",
              maximumQuestionCount: value.maximumQuestionCount,
              minimumAllowedQuestionCount,
              minimumQuestionCount: value.minimumQuestionCount,
              recommendedQuestionCount: value.recommendedQuestionCount,
            },
            requestId,
            revision,
            value,
          });
        })
        .catch((error: unknown) => {
          if (abortController.signal.aborted) return;
          apply({
            type: "preview/failed",
            fingerprint,
            message: error instanceof Error ? error.message : errorMessage,
            requestId,
            revision,
          });
        });
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [
    apply,
    delayMs,
    enabled,
    errorMessage,
    projection,
    refreshVersion,
    revision,
    submission.status,
    transport,
  ]);
}
