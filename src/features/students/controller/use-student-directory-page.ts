"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  normalizeStudentDirectoryFilters,
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

async function reloadVisibleDirectory(input: {
  filters: StudentDirectoryFilters;
  removedIds: ReadonlySet<string>;
  signal: AbortSignal;
  targetCount: number;
}) {
  let snapshot = withoutRemovedStudents(
    await loadStudentDirectorySnapshot(
      { filters: input.filters, mode: "initial" },
      input.signal,
    ),
    input.removedIds,
  );
  while (
    snapshot.page.nextCursor &&
    snapshot.page.items.length < input.targetCount
  ) {
    const page = await loadStudentDirectoryNextPage(
      {
        cursor: snapshot.page.nextCursor,
        filters: snapshot.filters,
        mode: "page",
      },
      input.signal,
    );
    snapshot = {
      ...snapshot,
      page: {
        items: appendUniqueStudents(
          snapshot.page.items,
          page.items,
          input.removedIds,
        ),
        nextCursor: page.nextCursor,
      },
    };
  }
  return snapshot;
}

export function useStudentDirectoryPage(
  initialSnapshot: StudentDirectorySnapshot,
) {
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
  const removedIdsRef = useRef(new Set<string>());
  const visibleCountRef = useRef(initialSnapshot.page.items.length);

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

  useEffect(() => {
    visibleCountRef.current = snapshot.page.items.length;
  }, [snapshot.page.items.length]);

  const reloadCurrent = useCallback(async () => {
    const targetCount = visibleCountRef.current;
    const requestedFilters = requestedFiltersRef.current;
    stopCurrentRequest();
    const requestVersion = requestVersionRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    setFiltering(true);
    setLoadingMore(false);
    setError("");
    setFilters(requestedFilters);
    try {
      const result = await reloadVisibleDirectory({
        filters: requestedFilters,
        removedIds: removedIdsRef.current,
        signal: abort.signal,
        targetCount,
      });
      if (requestVersionRef.current !== requestVersion) return;
      acceptedFiltersRef.current = result.filters;
      requestedFiltersRef.current = result.filters;
      setFilters(result.filters);
      setSnapshot(result);
    } catch (requestError) {
      if (abort.signal.aborted || requestVersionRef.current !== requestVersion) return;
      requestedFiltersRef.current = acceptedFiltersRef.current;
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
  }, [stopCurrentRequest]);

  useEffect(() => subscribeStudentRemoved((studentId) => {
    removedIdsRef.current.add(studentId);
    setSnapshot((current) => withoutRemovedStudents(
      current,
      removedIdsRef.current,
    ));
    void reloadCurrent();
  }), [reloadCurrent]);

  useEffect(
    () => subscribeStudentDirectoryRefresh(() => void reloadCurrent()),
    [reloadCurrent],
  );

  const replaceFilters = useCallback((
    nextFilters: StudentDirectoryFilters,
    delay = 0,
  ) => {
    const next = normalizeStudentDirectoryFilters(nextFilters);
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
          await loadStudentDirectorySnapshot(
            { filters: next, mode: "initial" },
            abort.signal,
          ),
          removedIdsRef.current,
        );
        if (requestVersionRef.current !== requestVersion) return;
        acceptedFiltersRef.current = result.filters;
        requestedFiltersRef.current = result.filters;
        setFilters(result.filters);
        setSnapshot(result);
      } catch (requestError) {
        if (abort.signal.aborted || requestVersionRef.current !== requestVersion) return;
        requestedFiltersRef.current = acceptedFiltersRef.current;
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
  }, [stopCurrentRequest]);

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
        { cursor, filters: snapshot.filters, mode: "page" },
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
  }, [filtering, loadingMore, snapshot]);

  return {
    error,
    filtering,
    filters,
    loadingMore,
    snapshot,
    actions: {
      loadMore,
      replaceFilters,
      replaceQuery: (query: string) =>
        replaceFilters({ ...filters, query }, 250),
    },
  };
}

export type StudentDirectoryController = ReturnType<
  typeof useStudentDirectoryPage
>;
