"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { subscribeAdminHistoryMutation } from "@/features/history/public-client";

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

  const beginRequest = useCallback((kind: "filter" | "more" | "refresh") => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const requestVersion = ++requestVersionRef.current;
    if (kind !== "more") {
      // A new first-page snapshot makes every cursor from the previous
      // snapshot invalid, even when that refresh later fails.
      setPage((current) => ({ ...current, nextCursor: null }));
    }
    setFiltering(kind === "filter");
    setLoadingMore(kind === "more");
    return { abort, requestVersion };
  }, []);

  const replaceFilters = useCallback(async (
    nextFilters: StudentHistoryFilters,
  ) => {
    setFilters(nextFilters);
    setError("");
    const { abort, requestVersion } = beginRequest("filter");
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
  }, [beginRequest, input.studentId]);

  const refreshFirstPage = useCallback(async () => {
    setError("");
    const { abort, requestVersion } = beginRequest("refresh");
    try {
      const nextPage = await loadStudentHistoryInitial(
        input.studentId,
        { filters, mode: "initial" },
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
          : "변경된 학생 시험 내역을 불러오지 못했습니다.",
      );
    } finally {
      if (requestVersionRef.current === requestVersion) {
        abortRef.current = null;
      }
    }
  }, [beginRequest, filters, input.studentId]);

  useEffect(() => subscribeAdminHistoryMutation((notice) => {
    if (notice.receipt.studentId === input.studentId) {
      void refreshFirstPage();
    }
  }), [input.studentId, refreshFirstPage]);

  const loadMore = useCallback(async () => {
    if (!page.nextCursor || filtering || loadingMore || abortRef.current) return;
    const cursor = page.nextCursor;
    setError("");
    const { abort, requestVersion } = beginRequest("more");
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
      if (
        abortRef.current === abort &&
        requestVersionRef.current === requestVersion
      ) {
        setLoadingMore(false);
        abortRef.current = null;
      }
    }
  }, [beginRequest, filtering, filters, input.studentId, loadingMore, page.nextCursor]);

  return {
    error,
    filtering,
    filters,
    loadingMore,
    page,
    actions: { loadMore, refreshFirstPage, replaceFilters },
  };
}

export type StudentHistoryPageController = ReturnType<
  typeof useStudentHistoryPage
>;
