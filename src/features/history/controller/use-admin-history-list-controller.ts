"use client";

import { useCallback, useEffect, useState } from "react";
import { normalizeAdminHistoryQuery, type AdminHistorySnapshot } from "../contracts/admin-history-read-model";
import { historyFailureKind, isHistoryAccessFailure, type AdminHistoryFailureKind } from "../contracts/admin-history-request-error";
import type { AdminHistoryStatusFilter } from "../domain/learning-activity";
import { loadAdminHistorySnapshot } from "../transport/history-pages";
import { useHistoryListCache } from "./history-list-cache-provider";

const SEARCH_DELAY_MS = 300;

export function useAdminHistoryListController(
  initialSnapshot: AdminHistorySnapshot,
  { query, statusFilter }: { query: string; statusFilter: AdminHistoryStatusFilter },
  cacheEnabled = false,
) {
  const context = useHistoryListCache();
  const cache = cacheEnabled ? context?.cache : undefined;
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [retryRevision, setRetryRevision] = useState(0);
  const [accessFailure, setAccessFailure] = useState<AdminHistoryFailureKind | null>(null);
  const normalizedQuery = normalizeAdminHistoryQuery(query);
  const requestKey = JSON.stringify([normalizedQuery, statusFilter, retryRevision]);
  const [requestState, setRequestState] = useState<{
    key: string;
    failure: AdminHistoryFailureKind | null;
  }>({ key: requestKey, failure: null });

  // Reset only this component's request state before displaying a new selection.
  // Keying failures also prevents A → B → A from reviving a failed old request.
  if (requestState.key !== requestKey) {
    setRequestState({ key: requestKey, failure: null });
  }
  const conditionsMatchSnapshot =
    normalizedQuery === snapshot.query && statusFilter === snapshot.statusFilter;
  const currentFailure = requestState.key === requestKey ? requestState.failure : null;
  const failure = accessFailure ?? (conditionsMatchSnapshot ? null : currentFailure);
  const isCurrentSnapshot = conditionsMatchSnapshot && !accessFailure;
  const reportAccessFailure = useCallback((kind: AdminHistoryFailureKind) => {
    if (isHistoryAccessFailure(kind)) { setAccessFailure(kind); cache?.lock(); }
  }, [cache]);

  useEffect(() => {
    cache?.rememberFilters({ currentOnly: false, query: normalizedQuery, statusFilter });
  }, [cache, normalizedQuery, statusFilter]);

  useEffect(() => {
    if (conditionsMatchSnapshot || accessFailure) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      const read = cache
        ? cache.read({ currentOnly: false, query: normalizedQuery, statusFilter }, controller.signal, retryRevision > 0).then(result => result.snapshot)
        : loadAdminHistorySnapshot({
        currentOnly: initialSnapshot.currentOnly,
        mode: "initial",
        query: normalizedQuery,
        statusFilter,
      }, controller.signal);
      void read
        .then((nextSnapshot) => {
          if (!controller.signal.aborted) setSnapshot(nextSnapshot);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const kind = historyFailureKind(error);
          setRequestState({ key: requestKey, failure: kind });
          reportAccessFailure(kind);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [conditionsMatchSnapshot, accessFailure, initialSnapshot.currentOnly,
    normalizedQuery, requestKey, statusFilter, reportAccessFailure, cache, retryRevision]);

  return {
    failure,
    isCurrentSnapshot,
    loading: !isCurrentSnapshot && !failure,
    reportAccessFailure,
    retry: () => setRetryRevision((revision) => revision + 1),
    snapshot,
  };
}
