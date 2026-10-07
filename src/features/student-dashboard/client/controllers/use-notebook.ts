"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { mistakeFiltersSchema, type MistakeFilters, type MistakeStudyPage } from "@/features/students/public-contracts";
import { loadNotebook, NotebookRequestError } from "../transport/notebook-transport";
import { subscribeStudentPrivateCacheChanges, useInitialServerHydration } from "@/features/session/public-client";

export function useNotebook(initial: MistakeStudyPage | undefined, initialFilters: MistakeFilters, boundary: { identity: string; initialIdentity: string }) {
  const hydrating = useInitialServerHydration();
  const [seeded] = useState(() => !!initial && hydrating && boundary.identity === boundary.initialIdentity);
  const blocked = useRef(boundary.identity !== boundary.initialIdentity);
  const [page, setPage] = useState<MistakeStudyPage>(() => seeded && initial ? initial : {
    view: initialFilters.view, stateVersion: "0", sourceVersion: "0".repeat(64),
    items: [], nextCursor: null, totalCount: null, summary: null, datasetOptions: null,
  });
  const [filters, setFilters] = useState(initialFilters);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(() => boundary.identity !== boundary.initialIdentity);
  const [fresh, setFresh] = useState(seeded);
  const [resetRevision, setResetRevision] = useState(0);
  const current = useRef<{ abort: AbortController; more: boolean } | null>(null);
  const active = useRef(true);
  const filtersRef = useRef(filters);
  const pageRef = useRef(page);
  useEffect(() => { pageRef.current = page; }, [page]);
  useEffect(() => { active.current = true; return () => { active.current = false; current.current?.abort.abort(); }; }, []);
  const invalidate = useCallback(() => {
    setFresh(false); setResetRevision(value => value + 1);
    setPage(old => ({ ...old, items: [], nextCursor: null, totalCount: null, summary: null, datasetOptions: null }));
    pageRef.current = { ...pageRef.current, items: [], nextCursor: null, totalCount: null, summary: null, datasetOptions: null };
  }, []);
  const load = useCallback(async (next: MistakeFilters, more = false) => {
    if (blocked.current || document.visibilityState === "hidden") return;
    if (more && (current.current || !pageRef.current.nextCursor)) return;
    current.current?.abort.abort();
    const request = { abort: new AbortController(), more };
    current.current = request;
    filtersRef.current = next;
    setFilters(next); setBusy(true); setError(null);
    if (!more) { setFresh(false); setPage(old => ({ ...old, nextCursor: null })); }
    if (!mistakeFiltersSchema.safeParse(next).success) {
      setError("조회 조건을 확인해 주세요."); setBusy(false); current.current = null; return;
    }
    try {
      let result: MistakeStudyPage;
      try {
        result = await loadNotebook(next, more ? pageRef.current.nextCursor : null, request.abort.signal, boundary.identity);
        if (more && (result.view !== pageRef.current.view || result.stateVersion !== pageRef.current.stateVersion
          || result.sourceVersion !== pageRef.current.sourceVersion)) throw new NotebookRequestError(409);
      } catch (cause) {
        if (!active.current || current.current !== request || request.abort.signal.aborted || !(cause instanceof NotebookRequestError) || cause.status !== 409) throw cause;
        invalidate(); setError(cause.message); request.more = false;
        // One bounded recovery; another failure leaves the explicit retry button.
        result = await loadNotebook(next, null, request.abort.signal, boundary.identity);
      }
      if (!active.current || current.current !== request) return;
      if (result.view !== next.view) throw new NotebookRequestError(502);
      setPage(old => request.more ? { ...old, items: [...old.items, ...result.items.filter(word => !old.items.some(item => item.key === word.key))], nextCursor: result.nextCursor } : result);
      setFresh(true);
    } catch (cause) {
      if (!active.current || current.current !== request || request.abort.signal.aborted) return;
      if (cause instanceof NotebookRequestError && (cause.status === 401 || cause.status === 403)) {
        blocked.current = true; setDenied(true); invalidate();
      }
      setError(cause instanceof NotebookRequestError ? cause.message : "단어를 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (active.current && current.current === request) { current.current = null; setBusy(false); }
    }
  }, [invalidate, boundary.identity]);
  useEffect(() => {
    let disposed = false, queued = false;
    const cancel = () => {
      current.current?.abort.abort(); current.current = null;
      invalidate(); setBusy(false);
    };
    const refresh = () => {
      cancel();
      if (queued || blocked.current || document.visibilityState === "hidden") return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!disposed && !blocked.current && document.visibilityState !== "hidden") void load(filtersRef.current);
      });
    };
    const visibility = () => { if (document.visibilityState === "hidden") cancel(); else refresh(); };
    const show = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    const unsubscribe = subscribeStudentPrivateCacheChanges(kind => {
      if (kind === "identity") { blocked.current = true; cancel(); setDenied(true); }
      else refresh();
    });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", cancel); window.addEventListener("pageshow", show);
    if (!seeded) refresh();
    return () => {
      disposed = true; unsubscribe(); current.current?.abort.abort(); current.current = null;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", cancel); window.removeEventListener("pageshow", show);
    };
  }, [invalidate, load, seeded]);
  return { page, filters, busy, error, denied, fresh, resetRevision, invalidate, load, more: () => load(filtersRef.current, true), retry: () => load(filtersRef.current) };
}
