"use client";

import { useCallback, useState } from "react";
import type { BulkAssignmentPreviewResponse } from "../api/response-adapters";
import { bulkCapacityIdentity, summarizeBulkCapacity, type BulkCapacitySummary } from "../application/bulk-capacity-summary";
import type { BulkSeriesAssignmentDraft } from "../domain/model";

// This hook owns only the lifetime of a single display summary.
// The assignment editor continues to own preview/submission validation.
export function useBulkCapacity({
  enabled, studentIds, draft, submissionSucceeded,
}: {
  enabled: boolean;
  studentIds: readonly string[];
  draft: BulkSeriesAssignmentDraft;
  submissionSucceeded: boolean;
}) {
  const ownerKey = enabled ? JSON.stringify([...studentIds].sort()) : "disabled";
  const [state, setState] = useState<{
    ownerKey: string;
    entry: { scopeKey: string; summary: BulkCapacitySummary } | null;
  }>({ ownerKey, entry: null });
  if (state.ownerKey !== ownerKey) setState({ ownerKey, entry: null });
  const clear = useCallback(() => setState(current =>
    current.entry ? { ...current, entry: null } : current), []);
  const remember = useCallback((
    acceptedDraft: BulkSeriesAssignmentDraft,
    preview: BulkAssignmentPreviewResponse,
  ) => {
    const scopeKey = bulkCapacityIdentity(acceptedDraft);
    setState(current => ({
      ...current,
      entry: scopeKey ? { scopeKey, summary: summarizeBulkCapacity(preview, acceptedDraft) } : null,
    }));
  }, []);
  return {
    clear, remember,
    value: enabled && !submissionSucceeded && state.ownerKey === ownerKey &&
        ownerKey === JSON.stringify([...draft.studentIds].sort()) &&
        state.entry?.scopeKey === bulkCapacityIdentity(draft)
      ? state.entry.summary : null,
  };
}
