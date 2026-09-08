"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { adminStudentsText } from "@/content/ko/admin-students";
import { announceAdminPrivateCacheChange } from "@/features/session/public-client";
import { readStudentProfileSaveResult, updateStudentProfile } from "../actions/update-student-profile";
import type { StudentDetailProfile } from "../contracts/student-detail-read-model";
import type { StudentProfileMutationReceipt } from "../contracts/student-mutation-result";

type StudentProfileDraft = { displayName: string; gradeLabel: string; schoolName: string };
type Feedback = { message: string; tone: "danger" | "success" | "neutral" };
function draftFromStudent(student: Pick<StudentDetailProfile, "displayName" | "schoolName" | "gradeLabel">): StudentProfileDraft {
  return { displayName: student.displayName, gradeLabel: student.gradeLabel ?? "", schoolName: student.schoolName ?? "" };
}
function equalDraft(a: StudentProfileDraft, b: StudentProfileDraft) {
  return a.displayName === b.displayName && a.schoolName === b.schoolName && a.gradeLabel === b.gradeLabel;
}

export function useStudentProfileController(input: {
  onUpdated: (receipt: StudentProfileMutationReceipt) => void; student: StudentDetailProfile;
}) {
  const { student } = input;
  const freshState = () => ({ baseVersion: student.updatedAt, baseline: draftFromStudent(student), draft: draftFromStudent(student), studentId: student.id });
  const [draftState, setDraftState] = useState(freshState);
  const currentState = draftState.studentId === student.id ? draftState : freshState();
  const { baseVersion, baseline, draft } = currentState;
  const [operation, setOperation] = useState<{ studentId: string; busy: boolean; checking: boolean; needsCheck: boolean; locked: boolean; feedback: Feedback | null }>({
    studentId: student.id, busy: false, checking: false, needsCheck: false, locked: false, feedback: null,
  });
  const own = operation.studentId === student.id;
  const busy = own && operation.busy, needsCheck = own && operation.needsCheck, locked = own && operation.locked;
  const unchanged = equalDraft(draft, baseline);
  const requestVersionRef = useRef(0);
  const inFlightRef = useRef(false);
  const guardRef = useRef({ studentId: student.id, needsCheck: false, locked: false });
  useEffect(() => {
    guardRef.current = { studentId: student.id, needsCheck: false, locked: false };
    return () => { requestVersionRef.current += 1; inFlightRef.current = false; };
  }, [student.id]);
  function show(feedback: Feedback, options: { needsCheck?: boolean; locked?: boolean } = {}) {
    if (guardRef.current.studentId !== student.id) return;
    Object.assign(guardRef.current, options);
    setOperation(current => ({ ...current, studentId: student.id, feedback, ...options }));
  }
  function lock() {
    show({ tone: "danger", message: adminStudentsText.info.profileAuthError }, { locked: true });
    announceAdminPrivateCacheChange("identity");
  }
  function adopt(receipt: StudentProfileMutationReceipt, submitted?: StudentProfileDraft) {
    const savedDraft = draftFromStudent(receipt.student);
    setDraftState(current => current.studentId !== student.id ? current : {
      ...current, baseVersion: receipt.version, baseline: savedDraft,
      draft: submitted && equalDraft(current.draft, submitted) ? savedDraft : current.draft,
    });
    input.onUpdated(receipt);
  }
  async function run(checking: boolean) {
    const guard = guardRef.current;
    if (guard.studentId !== student.id || busy || inFlightRef.current || guard.locked || (!checking && (guard.needsCheck || unchanged || !draft.displayName.trim()))) return;
    inFlightRef.current = true;
    const version = ++requestVersionRef.current;
    const submitted = { ...draft };
    setOperation({ studentId: student.id, busy: true, checking, feedback: null, needsCheck: guard.needsCheck, locked: guard.locked });
    try {
      const result = checking
        ? await readStudentProfileSaveResult({ studentId: student.id })
        : await updateStudentProfile({ ...submitted, baseVersion, studentId: student.id });
      if (requestVersionRef.current !== version) return;
      if (!result.ok) {
        if (result.status === 401) { lock(); return; }
        if (result.status === 409 && result.current.student.id === student.id) {
          adopt(result.current);
          show({ tone: "danger", message: adminStudentsText.info.profileConflict }, { needsCheck: false });
          return;
        }
        const unknown = checking || result.status === 409 || result.outcome === "unknown";
        show({ tone: "danger", message: checking ? adminStudentsText.info.profileCheckError : unknown ? adminStudentsText.info.profileUnknown
          : result.status === 400 ? "학생 이름과 학교·학년 입력을 확인해 주세요." : "학생 정보를 저장하지 못했습니다. 입력은 유지했습니다. 잠시 후 다시 저장해 주세요." }, { needsCheck: unknown });
        return;
      }
      if (result.receipt.student.id !== student.id || result.receipt.version !== result.receipt.student.updatedAt) {
        show({ tone: "danger", message: adminStudentsText.info.profileUnknown }, { needsCheck: true }); return;
      }
      const matches = equalDraft(draftFromStudent(result.receipt.student), {
        displayName: submitted.displayName.trim(), schoolName: submitted.schoolName.trim(), gradeLabel: submitted.gradeLabel.trim(),
      });
      adopt(result.receipt, !checking || matches ? submitted : undefined);
      show({ tone: checking && !matches ? "neutral" : "success",
        message: checking && !matches ? adminStudentsText.info.profileChecked : adminStudentsText.info.profileSuccess }, { needsCheck: false });
      if (!checking) toast.success(adminStudentsText.info.profileSuccess);
    } catch {
      if (requestVersionRef.current !== version) return;
      show({ tone: "danger", message: checking ? adminStudentsText.info.profileCheckError : adminStudentsText.info.profileUnknown }, { needsCheck: true });
    } finally {
      if (requestVersionRef.current === version) {
        inFlightRef.current = false;
        setOperation(current => ({ ...current, busy: false, checking: false }));
      }
    }
  }
  return {
    busy, draft, unchanged, needsCheck, locked, checking: own && operation.checking, feedback: own ? operation.feedback : null,
    actions: {
      save: () => run(false),
      checkResult: () => run(true),
      setField: (field: keyof StudentProfileDraft, value: string) => {
        if (guardRef.current.studentId !== student.id || guardRef.current.locked) return;
        setDraftState(current => ({
          ...(current.studentId === student.id ? current : freshState()),
          draft: { ...(current.studentId === student.id ? current.draft : draftFromStudent(student)), [field]: value },
        }));
      },
    },
  };
}
export type StudentProfileController = ReturnType<typeof useStudentProfileController>;
