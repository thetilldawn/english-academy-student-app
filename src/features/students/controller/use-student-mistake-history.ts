"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { announceAdminPrivateCacheChange } from "@/features/session/public-client";
import type { MistakeFilters, AdminMistakePageView } from "../contracts/mistake-episode";
import { loadStudentMistakes, WrongWordRequestError } from "../api/wrong-word-transport";
import { mistakeFilterKey as filterKey } from "../contracts/mistake-episode";

const TTL = 30_000;

export function useStudentMistakeHistory({ active, cachedAt, cachedHistory, filters, loadErrorMessage, onLoaded, studentId }: {
  active: boolean; cachedAt: number | null; cachedHistory: AdminMistakePageView | null;
  filters: MistakeFilters; loadErrorMessage: string;
  onLoaded: (studentId: string, history: AdminMistakePageView | null) => void; studentId: string;
}) {
  const [{ loading, error, locked, invalidated }, updateStatus] = useReducer(
    (state: { loading: boolean; error: string; locked: boolean; invalidated: boolean }, patch: Partial<typeof state>) => ({ ...state, ...patch }),
    { loading: false, error: "", locked: false, invalidated: false },
  );
  const [request, setRequest] = useState({ version: 0, cursor: null as string | null, force: false });
  const requesting = useRef(false);
  const sequence = useRef(0);
  const followup = useRef(false);
  const recovered = useRef(false);
  const failedAttempt = useRef("");
  const invalidatedCache = useRef<AdminMistakePageView | null>(null);
  const key = filterKey(filters);
  const matching = cachedHistory && filterKey(cachedHistory.filters) === key ? cachedHistory : null;
  const { datasetId, level, query, minWrongCount, maxWrongCount, view, sort } = filters;

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
    const applied = { view, sort, datasetId, level, query: query.trim(), ...(minWrongCount === undefined ? {} : { minWrongCount }), ...(maxWrongCount === undefined ? {} : { maxWrongCount }) };
    const timer = setTimeout(() => {
      void loadStudentMistakes(studentId, abort.signal, applied, pageCursor).then(page => {
        if (abort.signal.aborted || sequence.current !== current) return;
        let loaded: AdminMistakePageView;
        if (pageCursor) {
          if (!matching || matching.nextCursor !== pageCursor || page.view !== matching.view || page.stateVersion !== matching.stateVersion || page.sourceVersion !== matching.sourceVersion) throw new WrongWordRequestError("오답 목록이 바뀌었습니다. 최신 목록에서 다시 선택해 주세요.", 409);
          const ids = new Set(matching.items.map(item => item.key));
          if (page.items.some(item => ids.has(item.key))) throw new WrongWordRequestError("오답 목록이 바뀌었습니다. 최신 목록에서 다시 선택해 주세요.", 409);
          loaded = { ...matching, items: [...matching.items, ...page.items.filter(item => !ids.has(item.key))], nextCursor: page.nextCursor };
        } else {
          if (page.summary === null || page.totalCount === null || page.datasetOptions === null || page.reviewDrafts === null) throw new Error(loadErrorMessage);
          loaded = { ...page, filters: applied, summary: page.summary, totalCount: page.totalCount, datasetOptions: page.datasetOptions, reviewDrafts: page.reviewDrafts };
        }
        recovered.current = false;
        updateStatus({ invalidated: false });
        invalidatedCache.current = null;
        failedAttempt.current = "";
        onLoaded(studentId, loaded);
      }).catch((failure: unknown) => {
        if (abort.signal.aborted || sequence.current !== current) return;
        failedAttempt.current = attemptKey;
        updateStatus({ invalidated: true });
        onLoaded(studentId, null);
        if (failure instanceof WrongWordRequestError && failure.status === 409 && !recovered.current) {
          recovered.current = true; followup.current = true; return;
        }
        if (failure instanceof WrongWordRequestError && (failure.status === 401 || failure.status === 403)) {
          announceAdminPrivateCacheChange("identity");
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
  }, [active, cachedAt, datasetId, key, level, minWrongCount, maxWrongCount, view, sort, loadErrorMessage, locked, matching, onLoaded, query, request, studentId]);

  const refresh = useCallback(() => {
    recovered.current = false;
    updateStatus({ invalidated: true });
    if (requesting.current) { followup.current = true; return; }
    setRequest(value => ({ version: value.version + 1, cursor: null, force: true }));
  }, []);
  const loadMore = useCallback(() => {
    if (requesting.current || invalidated || locked || !matching?.nextCursor) return;
    setRequest(value => ({ version: value.version + 1, cursor: matching.nextCursor, force: true }));
  }, [invalidated, locked, matching]);

  const lock = useCallback(() => {
    ++sequence.current; requesting.current = false; followup.current = false;
    updateStatus({ locked: true, invalidated: true, loading: false }); onLoaded(studentId, null);
  }, [onLoaded, studentId]);
  return { lock, error, loading, loadingMore: loading && !!request.cursor, locked, invalidated,
    history: locked ? null : matching, canLoadMore: !invalidated && !locked && !!matching?.nextCursor,
    isRequesting: useCallback(() => requesting.current, []), refresh, loadMore };
}
