"use client";

import { useEffect } from "react";

import {
  runAssignmentPreview,
  type AssignmentPreviewPreparation,
} from "../application/preview-flow";
import {
  createLatestRequestPolicy,
  type AssignmentRequestIdentity,
} from "../application/request-lifecycle";
import type { AssignmentOperationError } from "../application/assignment-operation-error";
import type { AssignmentTransport } from "../transport/assignment-transport";

export function useDebouncedAssignmentPreview<Value>({
  delayMs,
  enabled,
  onFailed,
  onRequested,
  onSucceeded,
  preparation,
  refreshVersion,
  revision,
  transport,
}: {
  delayMs: number;
  enabled: boolean;
  onFailed: (
    error: AssignmentOperationError,
    identity: AssignmentRequestIdentity,
  ) => void;
  onRequested: (identity: AssignmentRequestIdentity) => void;
  onSucceeded: (
    value: Value,
    identity: AssignmentRequestIdentity,
  ) => void;
  preparation: AssignmentPreviewPreparation<Value> | null;
  refreshVersion: number;
  revision: number;
  transport: AssignmentTransport;
}) {
  useEffect(() => {
    if (!enabled || !preparation) return;
    const abortController = new AbortController();
    const policy = createLatestRequestPolicy();
    const identity = {
      fingerprint: preparation.fingerprint,
      requestId: crypto.randomUUID(),
      revision,
    };
    const timeoutId = window.setTimeout(() => {
      policy.start(identity);
      onRequested(identity);
      void runAssignmentPreview({
        identity,
        isCurrent: policy.isCurrent,
        preparation: {
          ...preparation,
          request: { ...preparation.request, signal: abortController.signal },
        },
        transport,
      }).then((outcome) => {
        if (outcome.status === "stale") return;
        if (outcome.result.ok) {
          onSucceeded(outcome.result.value, identity);
          return;
        }
        if (outcome.result.error.kind !== "aborted") {
          onFailed(outcome.result.error, identity);
        }
      });
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
      policy.cancel(identity);
      abortController.abort();
    };
  }, [
    delayMs,
    enabled,
    onFailed,
    onRequested,
    onSucceeded,
    preparation,
    refreshVersion,
    revision,
    transport,
  ]);
}
