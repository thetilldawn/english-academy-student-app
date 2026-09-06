"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  normalizeStudentDirectoryFilters,
  studentDirectoryFilterKey,
  type StudentDirectoryFilters,
  type StudentDirectoryListItem,
  type StudentDirectorySnapshot,
  StudentDirectoryRequestError,
} from "@/features/students/public-contracts";
import {
  loadStudentDirectoryNextPage,
  loadStudentDirectorySnapshot,
  useStudentDirectoryCache,
} from "@/features/students/public-client";

function appendUnique(
  current: readonly StudentDirectoryListItem[],
  incoming: readonly StudentDirectoryListItem[],
) {
  const known = new Set(current.map((student) => student.id));
  return [
    ...current,
    ...incoming.filter((student) => !known.has(student.id)),
  ];
}

export function useAssignmentStudentDirectory(
  initialSnapshot: StudentDirectorySnapshot,
  cacheEnabled = false,
) {
  const context = useStudentDirectoryCache();
  const cache = cacheEnabled ? context?.cache : undefined;
  const readSnapshot = useCallback(async (next: StudentDirectoryFilters, signal: AbortSignal, force = false) =>
    cache ? (await cache.read(next, signal, force, "assignments")).snapshot
      : loadStudentDirectorySnapshot({ filters: next, mode: "initial" }, signal), [cache]);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [filters, setFilters] = useState(initialSnapshot.filters);
  const [filtering, setFiltering] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const requestVersionRef = useRef(0);
  const acceptedFiltersRef = useRef(initialSnapshot.filters);
  const filterRequestRef = useRef({ key: studentDirectoryFilterKey(initialSnapshot.filters), status: "ready" });
  const receivedSnapshotRef = useRef(initialSnapshot);

  const stopCurrentRequest = useCallback(() => {
    requestVersionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => () => stopCurrentRequest(), [stopCurrentRequest]);

  // A currently authorized first page replaces the old pages before display,
  // without remounting the separate selection basket or editor controllers.
  useLayoutEffect(() => {
    if (!cacheEnabled || receivedSnapshotRef.current === initialSnapshot) return;
    receivedSnapshotRef.current = initialSnapshot;
    stopCurrentRequest();
    acceptedFiltersRef.current = initialSnapshot.filters;
    filterRequestRef.current = { key: studentDirectoryFilterKey(initialSnapshot.filters), status: "ready" };
    setSnapshot(initialSnapshot); setFilters(initialSnapshot.filters);
    setFiltering(false); setLoadingMore(false); setError("");
  }, [initialSnapshot, stopCurrentRequest, cacheEnabled]);

  const replaceFilters = useCallback((
    nextFilters: StudentDirectoryFilters,
    delay = 0,
  ) => {
    const next = normalizeStudentDirectoryFilters(nextFilters);
    cache?.rememberFilters(next, "assignments");
    const key = studentDirectoryFilterKey(next);
    if (filterRequestRef.current.key === key && filterRequestRef.current.status !== "error") return;
    filterRequestRef.current = { key, status: "pending" };
    setFilters(next);
    setError("");
    stopCurrentRequest();
    const requestVersion = requestVersionRef.current;
    setFiltering(true);
    setLoadingMore(false);
    timerRef.current = window.setTimeout(async () => {
      timerRef.current = null;
      const abort = new AbortController();
      abortRef.current = abort;
      try {
        const result = await readSnapshot(next, abort.signal);
        if (requestVersionRef.current !== requestVersion) return;
        acceptedFiltersRef.current = result.filters;
        filterRequestRef.current = { key: studentDirectoryFilterKey(result.filters), status: "ready" };
        setFilters(result.filters);
        setSnapshot(result);
      } catch (requestError) {
        if (abort.signal.aborted || requestVersionRef.current !== requestVersion) return;
        filterRequestRef.current.status = "error";
        setFilters(acceptedFiltersRef.current);
        setError(
          requestError instanceof Error
            ? requestError.message
            : "학생 목록을 불러오지 못했습니다.",
        );
      } finally {
        if (requestVersionRef.current === requestVersion) {
          setFiltering(false);
          abortRef.current = null;
        }
      }
    }, delay);
  }, [stopCurrentRequest, readSnapshot, cache]);

  const loadMore = useCallback(async () => {
    const cursor = snapshot.page.nextCursor;
    if (!cursor || filtering || loadingMore) return;
    const requestVersion = requestVersionRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    setLoadingMore(true);
    setError("");
    try {
      const page = await loadStudentDirectoryNextPage(
        { cursor, filters: snapshot.filters, mode: "page", ...(cache ? { cacheIdentity: cache.identity, cacheUserId: cache.userId } : {}) },
        abort.signal,
      );
      if (requestVersionRef.current !== requestVersion) return;
      setSnapshot((current) => {
        if (current.snapshotAt !== snapshot.snapshotAt) return current;
        return {
          ...current,
          page: {
            items: appendUnique(current.page.items, page.items),
            nextCursor: page.nextCursor,
          },
        };
      });
    } catch (requestError) {
      if (!abort.signal.aborted && requestVersionRef.current === requestVersion) {
        if (cache && requestError instanceof StudentDirectoryRequestError && [401, 403].includes(requestError.status)) cache.lock();
        setError(
          requestError instanceof Error
            ? requestError.message
            : "다음 학생 목록을 불러오지 못했습니다.",
        );
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setLoadingMore(false);
        abortRef.current = null;
      }
    }
  }, [filtering, loadingMore, snapshot, cache]);

  const reloadFirstPage = useCallback(async () => {
    const nextFilters = acceptedFiltersRef.current;
    stopCurrentRequest();
    filterRequestRef.current = { key: studentDirectoryFilterKey(nextFilters), status: "pending" };
    setSnapshot((current) => ({ ...current, page: { ...current.page, nextCursor: null } }));
    const requestVersion = requestVersionRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    setFiltering(true);
    setLoadingMore(false);
    setError("");
    try {
      const result = await readSnapshot(nextFilters, abort.signal, true);
      if (requestVersionRef.current !== requestVersion) return;
      acceptedFiltersRef.current = result.filters;
      filterRequestRef.current = { key: studentDirectoryFilterKey(result.filters), status: "ready" };
      setFilters(result.filters);
      setSnapshot(result);
    } catch (requestError) {
      if (abort.signal.aborted || requestVersionRef.current !== requestVersion) return;
      filterRequestRef.current.status = "error";
      setError(
        requestError instanceof Error
          ? requestError.message
          : "학생 목록을 새로 불러오지 못했습니다.",
      );
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setFiltering(false);
        abortRef.current = null;
      }
    }
  }, [stopCurrentRequest, readSnapshot]);

  return {
    error,
    filtering,
    filters,
    loadingMore,
    snapshot,
    actions: {
      loadMore,
      reloadFirstPage,
      replaceFilters,
      replaceQuery: (query: string) =>
        replaceFilters({ ...filters, query }, 250),
    },
  };
}

export type AssignmentStudentDirectoryController = ReturnType<
  typeof useAssignmentStudentDirectory
>;
