"use client";

import { useCallback, useState } from "react";

import type { MistakeTarget } from "../contracts/mistake-episode";
import type { ReadingCurriculumStage } from "@/lib/admin/reading-curriculum";

import { createStudentWorksheetRequest } from "../api/wrong-word-transport";

export function useStudentWrongWordWorksheetAction({
  finish,
  start,
  studentId,
  worksheetErrorMessage,
}: {
  finish: () => void;
  start: () => boolean;
  studentId: string;
  worksheetErrorMessage: string;
}) {
  const [worksheetRequesting, setWorksheetRequesting] = useState(false);

  const requestWorksheet = useCallback(async (input: {
    curriculumStage: ReadingCurriculumStage;
  } & ({ questionIds: readonly string[] } | { targets: readonly MistakeTarget[] })
  ) => {
    if (
      ("targets" in input ? input.targets : input.questionIds).length === 0 ||
      ("targets" in input ? input.targets : input.questionIds).length > 50 ||
      !start()
    ) {
      return null;
    }
    setWorksheetRequesting(true);
    try {
      const payload = await createStudentWorksheetRequest(studentId, input);
      if (!payload.request || !payload.sync) {
        throw new Error(payload.error ?? worksheetErrorMessage);
      }
      return { request: payload.request, sync: payload.sync };
    } finally {
      setWorksheetRequesting(false);
      finish();
    }
  }, [finish, start, studentId, worksheetErrorMessage]);

  return { requestWorksheet, worksheetRequesting };
}
