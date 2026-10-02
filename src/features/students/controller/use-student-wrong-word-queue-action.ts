"use client";

import { useCallback, useState } from "react";

import type { MistakeTarget } from "../contracts/mistake-episode";
import { queueStudentMistakes, queueStudentWrongWords } from "../api/wrong-word-transport";

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

  const queueWords = useCallback(async (questionIds: readonly string[] | readonly MistakeTarget[]) => {
    if (questionIds.length === 0 || !start()) return null;
    setQueueing(true);
    try {
      const payload = typeof questionIds[0] === "string" ? await queueStudentWrongWords(studentId, questionIds as readonly string[]) : await queueStudentMistakes(studentId, questionIds as readonly MistakeTarget[]);
      if (!payload.queueIds) {
        throw new Error(("error" in payload ? payload.error : undefined) ?? queueErrorMessage);
      }
      return payload.queueIds;
    } finally {
      setQueueing(false);
      finish();
    }
  }, [finish, queueErrorMessage, start, studentId]);

  return { queueing, queueWords };
}
