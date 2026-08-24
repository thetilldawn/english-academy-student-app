"use client";

import { useCallback, useRef, useState } from "react";

import type { ReadingCurriculumStage } from "@/lib/admin/reading-curriculum";

import {
  cancelStudentReviewDraft,
  createStudentWorksheetRequest,
  queueStudentWrongWords,
} from "../api/wrong-word-transport";

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
  const [queueing, setQueueing] = useState(false);
  const [worksheetRequesting, setWorksheetRequesting] = useState(false);
  const [cancellingDraftId, setCancellingDraftId] = useState<string | null>(
    null,
  );
  const actionInFlightRef = useRef(false);

  const busy = queueing || worksheetRequesting || Boolean(cancellingDraftId);
  const unavailable = useCallback(
    () =>
      loading ||
      isHistoryRequesting() ||
      actionInFlightRef.current,
    [isHistoryRequesting, loading],
  );

  const queueWords = useCallback(async (questionIds: readonly string[]) => {
    if (unavailable() || questionIds.length === 0) return null;
    actionInFlightRef.current = true;
    setQueueing(true);
    try {
      const payload = await queueStudentWrongWords(studentId, questionIds);
      if (!payload.queueIds) {
        throw new Error(payload.error ?? queueErrorMessage);
      }
      return payload.queueIds;
    } finally {
      actionInFlightRef.current = false;
      setQueueing(false);
    }
  }, [queueErrorMessage, studentId, unavailable]);

  const requestWorksheet = useCallback(async (input: {
    questionIds: readonly string[];
    curriculumStage: ReadingCurriculumStage;
  }) => {
    if (
      unavailable() ||
      input.questionIds.length === 0 ||
      input.questionIds.length > 50
    ) {
      return null;
    }
    actionInFlightRef.current = true;
    setWorksheetRequesting(true);
    try {
      const payload = await createStudentWorksheetRequest(studentId, input);
      if (!payload.request || !payload.sync) {
        throw new Error(payload.error ?? worksheetErrorMessage);
      }
      return { request: payload.request, sync: payload.sync };
    } finally {
      actionInFlightRef.current = false;
      setWorksheetRequesting(false);
    }
  }, [studentId, unavailable, worksheetErrorMessage]);

  const cancelDraft = useCallback(async (draftId: string) => {
    if (unavailable() || !draftId) return null;
    actionInFlightRef.current = true;
    setCancellingDraftId(draftId);
    try {
      const payload = await cancelStudentReviewDraft(studentId, draftId);
      if (
        payload.status !== "cancelled" ||
        payload.queueDisposition !== "pending"
      ) {
        throw new Error(payload.error ?? cancelErrorMessage);
      }
      return payload;
    } finally {
      actionInFlightRef.current = false;
      setCancellingDraftId(null);
    }
  }, [cancelErrorMessage, studentId, unavailable]);

  return {
    busy,
    cancelDraft,
    cancellingDraftId,
    queueing,
    queueWords,
    requestWorksheet,
    worksheetRequesting,
  };
}
