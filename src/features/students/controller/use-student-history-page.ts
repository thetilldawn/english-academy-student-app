"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  emptyStudentHistoryFilters,
  type StudentHistoryFilters,
  type StudentHistoryPage,
} from "../contracts/student-detail-read-model";
import {
  loadStudentHistoryInitial,
  loadStudentHistoryNextPage,
} from "../transport/student-history-pages";

export function useStudentHistoryPage(input: {
  initialPage: StudentHistoryPage;
  studentId: string;
}) {
  const [filters, setFilters] = useState<StudentHistoryFilters>(
    emptyStudentHistoryFilters,
  );
  const [page, setPage] = useState(input.initialPage);
  const [filtering, setFiltering] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);

  useEffect(() => () => abortRef.current?.abort(), []);

  const replaceFilters = useCallback(async (
    nextFilters: StudentHistoryFilters,
  ) => {
    setFilters(nextFilters);
    setError("");
    setFiltering(true);
    requestVersionRef.current += 1;
    const requestVersion = requestVersionRef.current;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const nextPage = await loadStudentHistoryInitial(
        input.studentId,
        { filters: nextFilters, mode: "initial" },
        abort.signal,
      );
      if (requestVersionRef.current !== requestVersion) return;
      setPage(nextPage);
    } catch (requestError) {
      if (abort.signal.aborted || requestVersionRef.current !== requestVersion) {
        return;
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "학생 시험 내역을 불러오지 못했습니다.",
      );
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setFiltering(false);
        abortRef.current = null;
      }
    }
  }, [input.studentId]);

  const loadMore = useCallback(async () => {
    if (!page.nextCursor || filtering || loadingMore) return;
    const cursor = page.nextCursor;
    setLoadingMore(true);
    setError("");
    const requestVersion = requestVersionRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const nextPage = await loadStudentHistoryNextPage(
        input.studentId,
        { cursor, filters, mode: "page" },
        abort.signal,
      );
      if (requestVersionRef.current !== requestVersion) return;
      setPage((current) => {
        const known = new Set(current.items.map((item) => item.id));
        return {
          ...current,
          items: [
            ...current.items,
            ...nextPage.items.filter((item) => !known.has(item.id)),
          ],
          nextCursor: nextPage.nextCursor,
        };
      });
    } catch (requestError) {
      if (!abort.signal.aborted) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "다음 학생 시험 내역을 불러오지 못했습니다.",
        );
      }
    } finally {
      setLoadingMore(false);
      if (abortRef.current === abort) abortRef.current = null;
    }
  }, [filtering, filters, input.studentId, loadingMore, page.nextCursor]);

  return {
    error,
    filtering,
    filters,
    loadingMore,
    page,
    actions: { loadMore, replaceFilters },
  };
}

export type StudentHistoryPageController = ReturnType<
  typeof useStudentHistoryPage
>;
