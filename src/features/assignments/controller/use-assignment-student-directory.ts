"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  normalizeStudentDirectoryFilters,
  type StudentDirectoryFilters,
  type StudentDirectoryListItem,
  type StudentDirectorySnapshot,
} from "@/features/students/public-contracts";
import {
  loadStudentDirectoryNextPage,
  loadStudentDirectorySnapshot,
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

  const stopCurrentRequest = useCallback(() => {
    requestVersionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => () => stopCurrentRequest(), [stopCurrentRequest]);

  const replaceFilters = useCallback((
    nextFilters: StudentDirectoryFilters,
    delay = 0,
  ) => {
    const next = normalizeStudentDirectoryFilters(nextFilters);
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
        const result = await loadStudentDirectorySnapshot(
          { filters: next, mode: "initial" },
          abort.signal,
        );
        if (requestVersionRef.current !== requestVersion) return;
        acceptedFiltersRef.current = result.filters;
        setFilters(result.filters);
        setSnapshot(result);
      } catch (requestError) {
        if (abort.signal.aborted || requestVersionRef.current !== requestVersion) return;
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
    const requestVersion = requestVersionRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    setLoadingMore(true);
    setError("");
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
            items: appendUnique(current.page.items, page.items),
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

  const reloadFirstPage = useCallback(async () => {
    const nextFilters = acceptedFiltersRef.current;
    stopCurrentRequest();
    const requestVersion = requestVersionRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    setFiltering(true);
    setLoadingMore(false);
    setError("");
    try {
      const result = await loadStudentDirectorySnapshot(
        { filters: nextFilters, mode: "initial" },
        abort.signal,
      );
      if (requestVersionRef.current !== requestVersion) return;
      acceptedFiltersRef.current = result.filters;
      setFilters(result.filters);
      setSnapshot(result);
    } catch (requestError) {
      if (abort.signal.aborted || requestVersionRef.current !== requestVersion) return;
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
