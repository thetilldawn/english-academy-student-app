"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { notebookFiltersSchema, type NotebookFilters, type NotebookPage } from "@/features/students/public-contracts";
import { loadNotebook, NotebookRequestError } from "../transport/notebook-transport";

export function useNotebook(initial: NotebookPage) {
  const [page, setPage] = useState(initial);
  const [filters, setFilters] = useState<NotebookFilters>(() => notebookFiltersSchema.parse({}));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [fresh, setFresh] = useState(true);
  const current = useRef<{ abort: AbortController; more: boolean } | null>(null);
  const active = useRef(true);
  const filtersRef = useRef(filters);
  const pageRef = useRef(page);
  useEffect(() => { pageRef.current = page; }, [page]);
  useEffect(() => { active.current = true; return () => { active.current = false; current.current?.abort.abort(); }; }, []);
  const load = useCallback(async (next: NotebookFilters, more = false) => {
    if (more && (current.current || !pageRef.current.nextCursor)) return;
    current.current?.abort.abort();
    const request = { abort: new AbortController(), more };
    current.current = request;
    filtersRef.current = next;
    setFilters(next); setBusy(true); setError(null);
    if (!more) { setFresh(false); setPage(old => ({ ...old, nextCursor: null })); }
    if (!notebookFiltersSchema.safeParse(next).success) {
      setError("조회 조건을 확인해 주세요."); setBusy(false); current.current = null; return;
    }
    try {
      const result = await loadNotebook(next, more ? pageRef.current.nextCursor : null, request.abort.signal);
      if (!active.current || current.current !== request) return;
      setPage(old => more ? { ...old, items: [...old.items, ...result.items.filter(word => !old.items.some(item => item.key === word.key))], nextCursor: result.nextCursor } : result);
      setFresh(true);
    } catch (cause) {
      if (!active.current || current.current !== request || request.abort.signal.aborted) return;
      if (cause instanceof NotebookRequestError && (cause.status === 401 || cause.status === 403)) {
        setDenied(true); setPage({ items: [], nextCursor: null, summary: null, totalCount: null, datasetOptions: null });
      }
      setError(cause instanceof NotebookRequestError ? cause.message : "단어를 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (active.current && current.current === request) { current.current = null; setBusy(false); }
    }
  }, []);
  return { page, filters, busy, error, denied, fresh, load, more: () => load(filtersRef.current, true), retry: () => load(filtersRef.current) };
}
