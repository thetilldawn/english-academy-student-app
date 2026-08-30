"use client";

import { useCallback, useRef } from "react";

import { useStudentWrongWordDraftAction } from "./use-student-wrong-word-draft-action";
import { useStudentWrongWordQueueAction } from "./use-student-wrong-word-queue-action";
import { useStudentWrongWordWorksheetAction } from "./use-student-wrong-word-worksheet-action";

export function useStudentWrongWordActions({
  cancelErrorMessage,
  isHistoryRequesting,
  loading,
  queueErrorMessage,
  studentId,
  worksheetErrorMessage,
}: {
  cancelErrorMessage: string;
  isHistoryRequesting: () => boolean;
  loading: boolean;
  queueErrorMessage: string;
  studentId: string;
  worksheetErrorMessage: string;
}) {
  const actionInFlightRef = useRef(false);
  const start = useCallback(() => {
    if (loading || isHistoryRequesting() || actionInFlightRef.current) {
      return false;
    }
    actionInFlightRef.current = true;
    return true;
  }, [isHistoryRequesting, loading]);
  const finish = useCallback(() => {
    actionInFlightRef.current = false;
  }, []);

  const queue = useStudentWrongWordQueueAction({
    finish,
    queueErrorMessage,
    start,
    studentId,
  });
  const worksheet = useStudentWrongWordWorksheetAction({
    finish,
    start,
    studentId,
    worksheetErrorMessage,
  });
  const draft = useStudentWrongWordDraftAction({
    cancelErrorMessage,
    finish,
    start,
    studentId,
  });

  return {
    busy:
      queue.queueing ||
      worksheet.worksheetRequesting ||
      Boolean(draft.cancellingDraftId),
    ...draft,
    ...queue,
    ...worksheet,
  };
}
