"use client";

import { useCallback, useEffect, useState } from "react";
import { subscribeAdminPrivateCacheChanges } from "@/features/session/public-client";

import type { StudentDetailProfile } from "../contracts/student-detail-read-model";

export type StudentDetailInteractionState = {
  busy: boolean;
  dirty: boolean;
  locked?: boolean;
};

export function useStudentDetailShellState(initialStudent: StudentDetailProfile) {
  const [state, setState] = useState(() => ({
    interactionState: { busy: false, dirty: false, locked: false } as StudentDetailInteractionState,
    student: initialStudent,
  }));

  useEffect(() => subscribeAdminPrivateCacheChanges(kind => {
    if (kind === "identity") setState(current => ({ ...current, interactionState: { busy: false, dirty: false, locked: true } }));
  }), []);

  const setInteractionState = useCallback(
    (interactionState: StudentDetailInteractionState) => {
      setState((current) => current.interactionState.locked ? current : ({ ...current, interactionState }));
    },
    [],
  );
  const mergeStudent = useCallback((patch: Partial<StudentDetailProfile>) => {
    setState((current) => ({
      ...current,
      student: { ...current.student, ...patch },
    }));
  }, []);

  return {
    ...state,
    actions: { mergeStudent, setInteractionState },
  };
}
