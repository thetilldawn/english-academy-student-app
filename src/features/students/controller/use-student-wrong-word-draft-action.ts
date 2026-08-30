"use client";

import { useCallback, useState } from "react";

import { cancelStudentReviewDraft } from "../api/wrong-word-transport";

export function useStudentWrongWordDraftAction({
  cancelErrorMessage,
  finish,
  start,
  studentId,
}: {
  cancelErrorMessage: string;
  finish: () => void;
  start: () => boolean;
  studentId: string;
}) {
  const [cancellingDraftId, setCancellingDraftId] = useState<string | null>(
    null,
  );

  const cancelDraft = useCallback(async (draftId: string) => {
    if (!draftId || !start()) return null;
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
      setCancellingDraftId(null);
      finish();
    }
  }, [cancelErrorMessage, finish, start, studentId]);

  return { cancelDraft, cancellingDraftId };
}
