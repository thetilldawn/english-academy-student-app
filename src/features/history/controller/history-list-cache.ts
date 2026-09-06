import { createPrivateListCache } from "@/features/session/public-client";
import { emptyHistoryCacheFilters, historyCacheFilterKey, normalizeHistoryCacheFilters, type HistoryCacheFilters, type HistoryCacheRequest, type HistoryCacheResponse } from "../contracts/history-list-cache-contract";
import type { AdminHistorySnapshot } from "../contracts/admin-history-read-model";
import { AdminHistoryRequestError, historyFailureKind, isHistoryAccessFailure } from "../contracts/admin-history-request-error";
import { isHistorySnapshotAtLeast } from "../domain/history-snapshot-version";

type Reader = (input: HistoryCacheRequest, signal: AbortSignal) => Promise<HistoryCacheResponse>;
export function createHistoryListCache(userId: string, reader: Reader, now = Date.now) {
  let minimumVersion: string | null = null;
  const checked = (snapshot: AdminHistorySnapshot) => {
    if (snapshot.currentOnly || (minimumVersion && !isHistorySnapshotAtLeast(snapshot.snapshotAt, minimumVersion))) throw new AdminHistoryRequestError("invalid-response");
    return snapshot;
  };
  const cache = createPrivateListCache<HistoryCacheFilters, AdminHistorySnapshot, AdminHistorySnapshot, null, "history">(userId, {
    defaultConsumer: "history", defaultFilters: () => emptyHistoryCacheFilters,
    normalize: normalizeHistoryCacheFilters, key: historyCacheFilterKey,
    filters: snapshot => ({ currentOnly: false, query: snapshot.query, statusFilter: snapshot.statusFilter }),
    retain: checked, restore: checked,
    async reader(filters, reusable, signal) {
      const result = await reader({ mode: "cache", filters, ...(reusable ? { identity: reusable.identity } : {}) }, signal);
      if (signal.aborted) throw new DOMException("Request cancelled", "AbortError");
      return result.kind === "resume" ? { ...result, value: null } : { ...result, snapshot: checked(result.snapshot) };
    },
    error: status => new AdminHistoryRequestError(status === 401 ? "unauthenticated" : status === 502 ? "invalid-response" : "unavailable"),
    isAccessFailure: error => isHistoryAccessFailure(historyFailureKind(error)),
  }, now);
  return {
    ...cache,
    // Do not spread getters: identity/revision must remain live.
    get blocked() { return cache.blocked; }, get revision() { return cache.revision; },
    get lastFilters() { return cache.lastFilters; }, get identity() { return cache.identity; },
    get displayDeadlineAt() { return cache.displayDeadlineAt; },
    noteMutation(version: string) {
      if (!minimumVersion || isHistorySnapshotAtLeast(version, minimumVersion)) minimumVersion = version;
      cache.invalidate();
    },
  };
}
export type HistoryListCache = ReturnType<typeof createHistoryListCache>;
