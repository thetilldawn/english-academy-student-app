"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { adminStudentsText } from "@/content/ko/admin-students";

import { updateStudentProfile } from "../api/student-mutations";
import type { StudentDetailProfile } from "../contracts/student-detail-read-model";

type StudentProfileDraft = {
  displayName: string;
  gradeLabel: string;
  schoolName: string;
};

function draftFromStudent(student: StudentDetailProfile): StudentProfileDraft {
  return {
    displayName: student.displayName,
    gradeLabel: student.gradeLabel ?? "",
    schoolName: student.schoolName ?? "",
  };
}

export function useStudentProfileController(input: {
  onUpdated: () => void;
  student: StudentDetailProfile;
}) {
  const { student } = input;
  const [draftState, setDraftState] = useState(() => ({
    baseline: draftFromStudent(student),
    draft: draftFromStudent(student),
    studentId: student.id,
  }));
  const currentState = draftState.studentId === student.id
    ? draftState
    : {
        baseline: draftFromStudent(student),
        draft: draftFromStudent(student),
        studentId: student.id,
      };
  const { baseline, draft } = currentState;
  const [busy, setBusy] = useState(false);

  const unchanged = useMemo(
    () =>
      draft.displayName === baseline.displayName &&
      draft.schoolName === baseline.schoolName &&
      draft.gradeLabel === baseline.gradeLabel,
    [baseline, draft],
  );

  async function save() {
    if (busy || unchanged || !draft.displayName.trim()) return;
    setBusy(true);
    try {
      await updateStudentProfile(student.id, draft);
      setDraftState((current) => current.studentId === student.id
        ? { ...current, baseline: current.draft }
        : current);
      toast.success(adminStudentsText.info.profileSuccess);
      input.onUpdated();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : adminStudentsText.info.profileError,
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    draft,
    unchanged,
    actions: {
      save,
      setField: (field: keyof StudentProfileDraft, value: string) =>
        setDraftState((current) => ({
          baseline:
            current.studentId === student.id
              ? current.baseline
              : draftFromStudent(student),
          draft: {
            ...(current.studentId === student.id
              ? current.draft
              : draftFromStudent(student)),
            [field]: value,
          },
          studentId: student.id,
        })),
    },
  };
}

export type StudentProfileController = ReturnType<
  typeof useStudentProfileController
>;
