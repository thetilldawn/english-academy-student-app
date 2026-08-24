"use client";

import { useCallback, useRef, useState } from "react";

import { buildLegacyReviewCancelRequest } from "../api/request-adapters";
import { parseLegacyReviewCancelResponse } from "../api/response-adapters";
import type { LegacyReviewRecoveryDraft } from "../domain/model";
import {
  assignmentTransportError,
  browserAssignmentTransport,
  type AssignmentTransport,
} from "../transport/assignment-transport";

export type LegacyReviewRecoveryOutcome =
  | { ok: true }
  | { message: string; ok: false };

export function useLegacyReviewRecovery({
  draft,
  errorMessage,
  transport = browserAssignmentTransport,
}: {
  draft: LegacyReviewRecoveryDraft;
  errorMessage: string;
  transport?: AssignmentTransport;
}) {
  const [status, setStatus] = useState<"idle" | "recovering" | "succeeded">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const recoveringRef = useRef(false);

  const recover = useCallback(async (): Promise<LegacyReviewRecoveryOutcome> => {
    if (recoveringRef.current || status === "succeeded") {
      return { message: errorMessage, ok: false };
    }
    recoveringRef.current = true;
    setStatus("recovering");
    setMessage("");
    const request = buildLegacyReviewCancelRequest(draft);
    try {
      const response = await transport({
        method: request.method,
        url: request.endpoint,
      });
      if (!response.ok) {
        throw new Error(
          assignmentTransportError(response.data, errorMessage),
        );
      }
      try {
        parseLegacyReviewCancelResponse(response.data);
      } catch {
        throw new Error(errorMessage);
      }
      setStatus("succeeded");
      return { ok: true };
    } catch (error: unknown) {
      const failureMessage =
        error instanceof Error ? error.message : errorMessage;
      setMessage(failureMessage);
      setStatus("idle");
      return { message: failureMessage, ok: false };
    } finally {
      recoveringRef.current = false;
    }
  }, [draft, errorMessage, status, transport]);

  return {
    busy: status === "recovering",
    message,
    recover,
    status,
  };
}
