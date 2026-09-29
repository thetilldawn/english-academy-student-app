"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { navigateDocument } from "@/components/document-navigation";
import { StudentDashboardRequestError } from "../contracts/student-dashboard-request-error";

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
  const [navigationRequired, setNavigationRequired] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  const loadMore = useCallback(async () => {
    if (navigationRequired || !nextCursor || requestRef.current) return;
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
      if (requestError instanceof StudentDashboardRequestError &&
          [401, 403, 409].includes(requestError.status)) {
        setItems([]);
        setNextCursor(null);
        setNavigationRequired(true);
        const studentChanged = requestError.status === 409;
        setError(studentChanged ? studentAppText.dashboard.history.studentChanged : studentAppText.dashboard.history.authRequired);
        navigateDocument(studentChanged ? "/student" : "/", true);
        return;
      }
      setError(studentAppText.dashboard.history.loadError);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }, [navigationRequired, nextCursor]);

  return { navigationRequired, error, items, loadMore, loading, nextCursor };
}
