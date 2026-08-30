"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { adminStudentsText } from "@/content/ko/admin-students";

import { updateStudentProfile } from "../actions/update-student-profile";
import type { StudentDetailProfile } from "../contracts/student-detail-read-model";
import type { StudentProfileMutationReceipt } from "../contracts/student-mutation-result";

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
  onUpdated: (receipt: StudentProfileMutationReceipt) => void;
  student: StudentDetailProfile;
}) {
  const { student } = input;
  const [draftState, setDraftState] = useState(() => ({
    baseVersion: student.updatedAt,
    baseline: draftFromStudent(student),
    draft: draftFromStudent(student),
    studentId: student.id,
  }));
  const currentState = draftState.studentId === student.id
    ? draftState
    : {
        baseVersion: student.updatedAt,
        baseline: draftFromStudent(student),
        draft: draftFromStudent(student),
        studentId: student.id,
      };
  const { baseVersion, baseline, draft } = currentState;
  const [busy, setBusy] = useState(false);
  const requestVersionRef = useRef(0);
  const inFlightRef = useRef(false);

  const unchanged = useMemo(
    () =>
      draft.displayName === baseline.displayName &&
      draft.schoolName === baseline.schoolName &&
      draft.gradeLabel === baseline.gradeLabel,
    [baseline, draft],
  );

  async function save() {
    if (
      busy ||
      inFlightRef.current ||
      unchanged ||
      !draft.displayName.trim()
    ) return;
    inFlightRef.current = true;
    requestVersionRef.current += 1;
    const requestVersion = requestVersionRef.current;
    const submittedDraft = { ...draft };
    setBusy(true);
    try {
      const result = await updateStudentProfile({
        ...submittedDraft,
        baseVersion,
        studentId: student.id,
      });
      if (requestVersionRef.current !== requestVersion) return;
      if (!result.ok) {
        if (result.status === 409) {
          const currentBaseline = draftFromStudent({
            ...student,
            ...result.current.student,
          });
          setDraftState((current) => current.studentId === student.id
            ? {
                ...current,
                baseVersion: result.current.version,
                baseline: currentBaseline,
              }
            : current);
          input.onUpdated(result.current);
        }
        throw new Error(result.error);
      }
      const savedDraft = draftFromStudent({
        ...student,
        ...result.receipt.student,
      });
      setDraftState((current) => {
        if (current.studentId !== student.id) return current;
        const stillSubmitted =
          current.draft.displayName === submittedDraft.displayName &&
          current.draft.schoolName === submittedDraft.schoolName &&
          current.draft.gradeLabel === submittedDraft.gradeLabel;
        return {
          ...current,
          baseVersion: result.receipt.version,
          baseline: savedDraft,
          draft: stillSubmitted ? savedDraft : current.draft,
        };
      });
      toast.success(adminStudentsText.info.profileSuccess);
      input.onUpdated(result.receipt);
    } catch (error) {
      if (requestVersionRef.current !== requestVersion) return;
      toast.error(
        error instanceof Error
          ? error.message
          : adminStudentsText.info.profileError,
      );
    } finally {
      if (requestVersionRef.current === requestVersion) {
        inFlightRef.current = false;
        setBusy(false);
      }
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
          baseVersion:
            current.studentId === student.id
              ? current.baseVersion
              : student.updatedAt,
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
