"use client";

import { useCallback, useState } from "react";

import { queueStudentWrongWords } from "../api/wrong-word-transport";

export function useStudentWrongWordQueueAction({
  finish,
  queueErrorMessage,
  start,
  studentId,
}: {
  finish: () => void;
  queueErrorMessage: string;
  start: () => boolean;
  studentId: string;
}) {
  const [queueing, setQueueing] = useState(false);

  const queueWords = useCallback(async (questionIds: readonly string[]) => {
    if (questionIds.length === 0 || !start()) return null;
    setQueueing(true);
    try {
      const payload = await queueStudentWrongWords(studentId, questionIds);
      if (!payload.queueIds) {
        throw new Error(payload.error ?? queueErrorMessage);
      }
      return payload.queueIds;
    } finally {
      setQueueing(false);
      finish();
    }
  }, [finish, queueErrorMessage, start, studentId]);

  return { queueing, queueWords };
}
