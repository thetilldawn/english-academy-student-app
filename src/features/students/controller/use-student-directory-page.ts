"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StudentDirectoryRequestError } from "../contracts/student-directory-cache-contract";
import { useStudentDirectoryCache } from "./student-directory-cache-provider";

import {
  normalizeStudentDirectoryFilters,
  studentDirectoryFilterKey,
  type StudentDirectoryFilters,
  type StudentDirectoryListItem,
  type StudentDirectorySnapshot,
} from "../contracts/student-directory-read-model";
import {
  loadStudentDirectoryNextPage,
  loadStudentDirectorySnapshot,
} from "../transport/student-directory-pages";
import {
  subscribeStudentDirectoryRefresh,
  subscribeStudentRemoved,
} from "./student-directory-events";

function withoutRemovedStudents(
  snapshot: StudentDirectorySnapshot,
  removedIds: ReadonlySet<string>,
) {
  const items = snapshot.page.items.filter((student) => !removedIds.has(student.id));
  const removedCount = snapshot.page.items.length - items.length;
  return {
    ...snapshot,
    page: { ...snapshot.page, items },
    totalCount: Math.max(0, snapshot.totalCount - removedCount),
  };
}

function appendUniqueStudents(
  current: readonly StudentDirectoryListItem[],
  incoming: readonly StudentDirectoryListItem[],
  removedIds: ReadonlySet<string>,
) {
  const known = new Set(current.map((student) => student.id));
  return [
    ...current,
    ...incoming.filter(
      (student) => !removedIds.has(student.id) && !known.has(student.id),
    ),
  ];
}

export function useStudentDirectoryPage(
  initialSnapshot: StudentDirectorySnapshot,
) {
  const cache = useStudentDirectoryCache()?.cache;
  const readSnapshot = useCallback(async (filters: StudentDirectoryFilters, signal: AbortSignal, force = false) =>
    cache ? (await cache.read(filters, signal, force)).snapshot
      : loadStudentDirectorySnapshot({ filters, mode: "initial" }, signal), [cache]);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [filters, setFilters] = useState(initialSnapshot.filters);
  const [filtering, setFiltering] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const requestVersionRef = useRef(0);
  const acceptedFiltersRef = useRef(initialSnapshot.filters);
  const requestedFiltersRef = useRef(initialSnapshot.filters);
  const filterRequestRef = useRef({ key: studentDirectoryFilterKey(initialSnapshot.filters), status: "ready" });
  const removedIdsRef = useRef(new Set<string>());

  const stopCurrentRequest = useCallback(() => {
    requestVersionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(
    () => () => stopCurrentRequest(),
    [stopCurrentRequest],
  );

  const reloadCurrent = useCallback(async () => {
    const requestedFilters = requestedFiltersRef.current;
    stopCurrentRequest();
    filterRequestRef.current = { key: studentDirectoryFilterKey(requestedFilters), status: "pending" };
    setSnapshot((current) => ({ ...current, page: { ...current.page, nextCursor: null } }));
    const requestVersion = requestVersionRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    setFiltering(true);
    setLoadingMore(false);
    setError("");
    setFilters(requestedFilters);
    try {
      const result = withoutRemovedStudents(
        await readSnapshot(requestedFilters, abort.signal, true),
        removedIdsRef.current,
      );
      if (requestVersionRef.current !== requestVersion) return;
      acceptedFiltersRef.current = result.filters;
      requestedFiltersRef.current = result.filters;
      filterRequestRef.current = { key: studentDirectoryFilterKey(result.filters), status: "ready" };
      setFilters(result.filters);
      setSnapshot(result);
    } catch (requestError) {
      if (abort.signal.aborted || requestVersionRef.current !== requestVersion) return;
      requestedFiltersRef.current = acceptedFiltersRef.current;
      filterRequestRef.current.status = "error";
      setFilters(acceptedFiltersRef.current);
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

  useEffect(() => cache ? undefined : subscribeStudentRemoved((studentId) => {
    removedIdsRef.current.add(studentId);
    setSnapshot((current) => withoutRemovedStudents(
      current,
      removedIdsRef.current,
    ));
    void reloadCurrent();
  }), [reloadCurrent, cache]);

  useEffect(
    () => cache ? undefined : subscribeStudentDirectoryRefresh(() => void reloadCurrent()),
    [reloadCurrent, cache],
  );

  const replaceFilters = useCallback((
    nextFilters: StudentDirectoryFilters,
    delay = 0,
  ) => {
    const next = normalizeStudentDirectoryFilters(nextFilters);
    cache?.rememberFilters(next);
    const key = studentDirectoryFilterKey(next);
    if (filterRequestRef.current.key === key && filterRequestRef.current.status !== "error") return;
    filterRequestRef.current = { key, status: "pending" };
    requestedFiltersRef.current = next;
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
        const result = withoutRemovedStudents(
          await readSnapshot(next, abort.signal),
          removedIdsRef.current,
        );
        if (requestVersionRef.current !== requestVersion) return;
        acceptedFiltersRef.current = result.filters;
        requestedFiltersRef.current = result.filters;
        filterRequestRef.current = { key: studentDirectoryFilterKey(result.filters), status: "ready" };
        setFilters(result.filters);
        setSnapshot(result);
      } catch (requestError) {
        if (abort.signal.aborted || requestVersionRef.current !== requestVersion) return;
        requestedFiltersRef.current = acceptedFiltersRef.current;
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
    setLoadingMore(true);
    setError("");
    const requestVersion = requestVersionRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
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
            items: appendUniqueStudents(
              current.page.items,
              page.items,
              removedIdsRef.current,
            ),
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

  return {
    error,
    filtering,
    filters,
    loadingMore,
    snapshot,
    actions: {
      loadMore,
      retry: reloadCurrent,
      replaceFilters,
      replaceQuery: (query: string) =>
        replaceFilters({ ...filters, query }, 250),
    },
  };
}

export type StudentDirectoryController = ReturnType<
  typeof useStudentDirectoryPage
>;
