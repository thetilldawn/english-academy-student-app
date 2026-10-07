"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  syncInitialSnapshot = false,
  enabled = true,
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
  const incomingSnapshotRef = useRef(initialSnapshot);

  const displayedRef = useRef(initialSnapshot);
  const restoreCountRef = useRef(initialSnapshot.page.items.length);
  useEffect(() => {
    displayedRef.current = snapshot;
    restoreCountRef.current = Math.max(restoreCountRef.current, snapshot.page.items.length);
    cache?.rememberSnapshot(snapshot);
  }, [snapshot, cache]);

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

  useEffect(() => { if (!enabled) stopCurrentRequest(); }, [enabled, stopCurrentRequest]);

  useLayoutEffect(() => {
    if (!enabled || !syncInitialSnapshot || incomingSnapshotRef.current === initialSnapshot) return;
    const wasPending = incomingSnapshotRef.current.snapshotAt === "pending";
    incomingSnapshotRef.current = initialSnapshot;
    // A later search wins over a refresh started with an older filter.
    if (!wasPending && studentDirectoryFilterKey(initialSnapshot.filters) !== studentDirectoryFilterKey(requestedFiltersRef.current)) return;
    stopCurrentRequest();
    const previous = displayedRef.current;
    const targetCount = studentDirectoryFilterKey(previous.filters) === studentDirectoryFilterKey(initialSnapshot.filters)
      ? Math.max(restoreCountRef.current, previous.page.items.length) : initialSnapshot.page.items.length;
    restoreCountRef.current = targetCount;
    const next = withoutRemovedStudents(initialSnapshot, removedIdsRef.current);
    acceptedFiltersRef.current = next.filters;
    requestedFiltersRef.current = next.filters;
    filterRequestRef.current = { key: studentDirectoryFilterKey(next.filters), status: "ready" };
    setSnapshot(next);
    setFilters(next.filters);
    setError("");
    setFiltering(false);
    setLoadingMore(false);
    let restored = next;
    if (restored.page.items.length >= targetCount || !restored.page.nextCursor) return;
    const abort = new AbortController();
    abortRef.current = abort;
    const requestVersion = requestVersionRef.current;
    setLoadingMore(true);
    void (async () => {
      const cursors = new Set<string>();
      while (restored.page.items.length < targetCount && restored.page.nextCursor) {
        const cursor = restored.page.nextCursor;
        if (cursors.has(cursor)) throw new Error("다음 학생 목록을 다시 불러와 주세요.");
        cursors.add(cursor);
        const page = await loadStudentDirectoryNextPage({ mode: "page", filters: restored.filters, cursor,
          ...(cache ? { cacheIdentity: cache.identity, cacheUserId: cache.userId } : {}) }, abort.signal);
        if (abort.signal.aborted || requestVersionRef.current !== requestVersion) return;
        restored = { ...restored, page: { items: appendUniqueStudents(restored.page.items, page.items, removedIdsRef.current), nextCursor: page.nextCursor } };
        setSnapshot(restored);
        cache?.rememberSnapshot(restored);
      }
    })().catch((error: unknown) => {
      if (abort.signal.aborted || requestVersionRef.current !== requestVersion) return;
      if (error instanceof StudentDirectoryRequestError && [401, 403].includes(error.status)) cache?.lock();
      setError(error instanceof Error ? error.message : "펼친 학생 목록을 불러오지 못했습니다. 더보기를 다시 눌러 주세요.");
    }).finally(() => {
      if (requestVersionRef.current === requestVersion) { setLoadingMore(false); abortRef.current = null; }
    });
  }, [initialSnapshot, syncInitialSnapshot, stopCurrentRequest, enabled, cache]);

  const reloadCurrent = useCallback(async () => {
    if (!enabled) return;
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
  }, [stopCurrentRequest, readSnapshot, enabled]);

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
    if (!enabled) return;
    const next = normalizeStudentDirectoryFilters(nextFilters);
    cache?.rememberFilters(next);
    const key = studentDirectoryFilterKey(next);
    if (filterRequestRef.current.key === key && filterRequestRef.current.status !== "error") return;
    restoreCountRef.current = 0;
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
  }, [stopCurrentRequest, readSnapshot, cache, enabled]);

  const loadMore = useCallback(async () => {
    if (!enabled) return;
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
  }, [filtering, loadingMore, snapshot, cache, enabled]);

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
