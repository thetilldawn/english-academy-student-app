"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AdminHistoryListItem, AdminHistoryReadRequest, AdminHistorySectionPage,
} from "../contracts/admin-history-read-model";
import {
  AdminHistoryRequestError, historyFailureKind, isHistoryAccessFailure,
  type AdminHistoryFailureKind,
} from "../contracts/admin-history-request-error";
import type { AdminHistoryStatusFilter } from "../domain/learning-activity";
import { adminHistoryMutationImpact } from "../domain/admin-history-mutation";
import {
  loadAdminHistoryFreshSection, loadAdminHistoryNextPage, loadAdminHistorySnapshot,
} from "../transport/history-pages";
import { subscribeAdminHistoryMutation } from "./history-change-listener";
import type { HistoryFreshSectionReader } from "./history-refresh-coordinator";

export type AdminHistoryLoadMoreContext = {
  currentOnly: boolean;
  query: string;
  statusFilter: AdminHistoryStatusFilter;
};

function mergeUniqueItems(current: readonly AdminHistoryListItem[], incoming: readonly AdminHistoryListItem[]) {
  const known = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => {
    if (known.has(item.id)) return false;
    known.add(item.id);
    return true;
  })];
}

export function useAdminHistorySectionPage({
  loadMoreContext, onAccessFailure, section, readFreshSection = loadAdminHistoryFreshSection,
  onCursorRejected,
  mutationRefreshEnabled = true,
}: {
  loadMoreContext?: AdminHistoryLoadMoreContext;
  onAccessFailure?: (kind: AdminHistoryFailureKind) => void;
  onCursorRejected?: () => void;
  section: AdminHistorySectionPage;
  readFreshSection?: HistoryFreshSectionReader;
  mutationRefreshEnabled?: boolean;
}) {
  const [items, setItems] = useState(section.items);
  const [nextCursor, setNextCursor] = useState(section.nextCursor);
  const [totalCount, setTotalCount] = useState(section.totalCount);
  const [loading, setLoading] = useState(false);
  const [invalidated, setInvalidated] = useState(false);
  const [failure, setFailure] = useState<AdminHistoryFailureKind | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const retryRequestRef = useRef<AdminHistoryReadRequest | null>(null);
  const accessDeniedRef = useRef(false);

  useEffect(() => () => requestRef.current?.abort(), []);

  const runRequest = useCallback(async (request: AdminHistoryReadRequest) => {
    if (accessDeniedRef.current) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    retryRequestRef.current = request;
    setLoading(true);
    setFailure(null);
    if (request.mode !== "page") {
      // A committed mutation invalidates BOTH old rows/counts and its cursor.
      // Neither is presented as current if the replacement read fails.
      setInvalidated(true);
      setNextCursor(null);
    }
    try {
      if (request.mode === "page") {
        const page = await loadAdminHistoryNextPage(request, controller.signal);
        if (controller.signal.aborted || requestRef.current !== controller) return;
        setItems((current) => mergeUniqueItems(current, page.items));
        setNextCursor(page.nextCursor);
      } else {
        const fresh = request.mode === "section"
          ? await readFreshSection(request, controller.signal)
          : (await loadAdminHistorySnapshot(request, controller.signal))
            .sections.find((candidate) => candidate.groupKey === section.groupKey);
        if (controller.signal.aborted || requestRef.current !== controller) return;
        if (!fresh) throw new AdminHistoryRequestError("invalid-response");
        setItems(fresh.items);
        setNextCursor(fresh.nextCursor);
        setTotalCount(fresh.totalCount);
        setInvalidated(false);
      }
      retryRequestRef.current = null;
    } catch (error: unknown) {
      if (controller.signal.aborted || requestRef.current !== controller) return;
      const kind = historyFailureKind(error);
      if (kind === "invalid-request" && request.mode === "page") {
        // A rejected cursor must not be retried forever. Read a new initial
        // snapshot with a SERVER-assigned timestamp; do not invent one locally.
        retryRequestRef.current = {
          currentOnly: request.currentOnly, mode: "initial",
          query: request.query, statusFilter: request.statusFilter,
        };
        setInvalidated(true);
        setNextCursor(null);
        if (onCursorRejected) { onCursorRejected(); return; }
      }
      setFailure(kind);
      if (isHistoryAccessFailure(kind)) {
        accessDeniedRef.current = true;
        setNextCursor(null);
        onAccessFailure?.(kind);
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }, [onAccessFailure, onCursorRejected, section.groupKey, readFreshSection]);

  useEffect(() => subscribeAdminHistoryMutation((notice) => {
    if (!loadMoreContext || !mutationRefreshEnabled) return;
    const impact = adminHistoryMutationImpact(notice, loadMoreContext)
      .find((candidate) => candidate.groupKey === section.groupKey);
    if (!impact) return;
    void runRequest({
      ...loadMoreContext, groupKey: section.groupKey,
      mode: "section", snapshotAt: notice.receipt.version,
    });
  }), [loadMoreContext, runRequest, section.groupKey, mutationRefreshEnabled]);

  const loadMore = useCallback(async () => {
    if (!loadMoreContext || !nextCursor || requestRef.current) return;
    await runRequest({
      ...loadMoreContext, cursor: nextCursor, groupKey: section.groupKey, mode: "page",
    });
  }, [loadMoreContext, nextCursor, runRequest, section.groupKey]);

  const retry = useCallback(() => {
    if (requestRef.current || !retryRequestRef.current) return;
    return runRequest(retryRequestRef.current);
  }, [runRequest]);

  return {
    failure,
    items: isHistoryAccessFailure(failure) || invalidated ? [] : items,
    countKnown: !invalidated && !isHistoryAccessFailure(failure),
    loadMore, loading, nextCursor, retry, totalCount,
  };
}
