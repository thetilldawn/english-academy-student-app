"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  StudentAssignmentSummary,
  StudentDashboardCompletedPage,
} from "@/features/student-dashboard/contracts/student-dashboard-read-model";
import { loadStudentDashboardCompletedPage } from "@/features/student-dashboard/transport/student-dashboard-pages";
import { studentAppText } from "@/content/ko/student-app";

function mergeUniqueAssignments(
  current: readonly StudentAssignmentSummary[],
  incoming: readonly StudentAssignmentSummary[],
) {
  const known = new Set(current.map((assignment) => assignment.id));
  return [
    ...current,
    ...incoming.filter((assignment) => {
      if (known.has(assignment.id)) return false;
      known.add(assignment.id);
      return true;
    }),
  ];
}

export function useStudentCompletedAssignments(
  initialPage: StudentDashboardCompletedPage,
) {
  const [items, setItems] = useState(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const page = await loadStudentDashboardCompletedPage(
        nextCursor,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setItems((current) => mergeUniqueAssignments(current, page.items));
      setNextCursor(page.nextCursor);
    } catch (requestError) {
      if (controller.signal.aborted) return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : studentAppText.dashboard.history.loadError,
      );
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }, [nextCursor]);

  return { error, items, loadMore, loading, nextCursor };
}
