"use client";

import { useCallback, useState } from "react";

import type { StudentDetailProfile } from "../contracts/student-detail-read-model";

export type StudentDetailInteractionState = {
  busy: boolean;
  dirty: boolean;
};

export function useStudentDetailShellState(initialStudent: StudentDetailProfile) {
  const [state, setState] = useState(() => ({
    interactionState: { busy: false, dirty: false },
    student: initialStudent,
  }));

  const setInteractionState = useCallback(
    (interactionState: StudentDetailInteractionState) => {
      setState((current) => ({ ...current, interactionState }));
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
