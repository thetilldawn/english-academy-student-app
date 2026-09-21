"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { WrongWordPageFilters, WrongWordPageView } from "../contracts/wrong-word-page";
import { loadStudentWrongWords, WrongWordRequestError } from "../api/wrong-word-transport";

const TTL = 30_000;
const filterKey = (filters: WrongWordPageFilters) => JSON.stringify([filters.datasetId, filters.level, filters.query.trim()]);

export function useStudentWrongWordHistory({ active, cachedAt, cachedHistory, filters, loadErrorMessage, onLoaded, studentId }: {
  active: boolean; cachedAt: number | null; cachedHistory: WrongWordPageView | null;
  filters: WrongWordPageFilters; loadErrorMessage: string;
  onLoaded: (studentId: string, history: WrongWordPageView | null) => void; studentId: string;
}) {
  const [{ loading, error, locked, invalidated }, updateStatus] = useReducer(
    (state: { loading: boolean; error: string; locked: boolean; invalidated: boolean }, patch: Partial<typeof state>) => ({ ...state, ...patch }),
    { loading: false, error: "", locked: false, invalidated: false },
  );
  const [request, setRequest] = useState({ version: 0, cursor: null as string | null, force: false });
  const requesting = useRef(false);
  const sequence = useRef(0);
  const followup = useRef(false);
  const failedAttempt = useRef("");
  const invalidatedCache = useRef<WrongWordPageView | null>(null);
  const key = filterKey(filters);
  const matching = cachedHistory && filterKey(cachedHistory.filters) === key ? cachedHistory : null;
  const { datasetId, level, query } = filters;

  useEffect(() => {
    if (!active || locked || requesting.current) return;
    const attemptKey = JSON.stringify([studentId, key, request.version]);
    if (!request.force && failedAttempt.current === attemptKey) return;
    if (matching && matching !== invalidatedCache.current && cachedAt !== null && Date.now() - cachedAt < TTL && !request.force) {
      updateStatus({ loading: false, error: "", invalidated: false });
      return;
    }
    const abort = new AbortController();
    const current = ++sequence.current;
    requesting.current = true;
    updateStatus({ loading: true, error: "" });
    const pageCursor = matching ? request.cursor : null;
    if (!pageCursor) {
      if (matching) invalidatedCache.current = matching;
      updateStatus({ invalidated: true });
    }
    const applied = { datasetId, level, query: query.trim() };
    const timer = setTimeout(() => {
      void loadStudentWrongWords(studentId, abort.signal, applied, pageCursor).then(page => {
        if (abort.signal.aborted || sequence.current !== current) return;
        let view: WrongWordPageView;
        if (pageCursor) {
          if (!matching || matching.nextCursor !== pageCursor) throw new Error("첫 목록부터 다시 확인해 주세요.");
          const ids = new Set(matching.items.map(item => item.key));
          view = { ...matching, items: [...matching.items, ...page.items.filter(item => !ids.has(item.key))], nextCursor: page.nextCursor };
        } else {
          if (page.summary === null || page.totalCount === null || page.datasetOptions === null || page.reviewDrafts === null) throw new Error(loadErrorMessage);
          view = { ...page, filters: applied, summary: page.summary, totalCount: page.totalCount, datasetOptions: page.datasetOptions, reviewDrafts: page.reviewDrafts };
        }
        updateStatus({ invalidated: false });
        invalidatedCache.current = null;
        failedAttempt.current = "";
        onLoaded(studentId, view);
      }).catch((failure: unknown) => {
        if (abort.signal.aborted || sequence.current !== current) return;
        failedAttempt.current = attemptKey;
        if (failure instanceof WrongWordRequestError && (failure.status === 401 || failure.status === 403)) {
          updateStatus({ locked: true }); onLoaded(studentId, null);
        }
        updateStatus({ error: failure instanceof Error ? failure.message : loadErrorMessage });
      }).finally(() => {
        if (abort.signal.aborted || sequence.current !== current) return;
        requesting.current = false; updateStatus({ loading: false });
        const again = followup.current; followup.current = false;
        setRequest(value => ({ version: value.version + (again ? 1 : 0), cursor: null, force: again }));
      });
    }, query.trim() && !request.force ? 250 : 0);
    return () => { clearTimeout(timer); abort.abort(); requesting.current = false; };
  }, [active, cachedAt, datasetId, key, level, loadErrorMessage, locked, matching, onLoaded, query, request, studentId]);

  const refresh = useCallback(() => {
    updateStatus({ invalidated: true });
    if (requesting.current) { followup.current = true; return; }
    setRequest(value => ({ version: value.version + 1, cursor: null, force: true }));
  }, []);
  const loadMore = useCallback(() => {
    if (requesting.current || invalidated || locked || !matching?.nextCursor) return;
    setRequest(value => ({ version: value.version + 1, cursor: matching.nextCursor, force: true }));
  }, [invalidated, locked, matching]);

  return { error, loading, loadingMore: loading && !!request.cursor, locked, invalidated,
    history: locked ? null : matching, canLoadMore: !invalidated && !locked && !!matching?.nextCursor,
    isRequesting: useCallback(() => requesting.current, []), refresh, loadMore };
}
