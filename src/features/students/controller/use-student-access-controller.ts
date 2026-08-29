"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { formatContentText } from "@/content/format";
import { adminStudentsText } from "@/content/ko/admin-students";
import { buildStudentAccessUrl } from "@/lib/auth/student-code-input";
import { sendKakaoText } from "@/lib/kakao-share";

import {
  blockStudent,
  deleteStudent,
  revealStudentCode,
  rotateStudentCode,
} from "../api/student-mutations";
import type {
  StudentCodeView,
  StudentDetailProfile,
} from "../contracts/student-detail-read-model";
import { announceStudentRemoved } from "./student-directory-events";

export function useStudentAccessController(input: {
  appOrigin: string;
  onRemoved: () => void;
  onUpdated: () => void;
  student: StudentDetailProfile;
}) {
  const studentId = input.student.id;
  const [busyState, setBusyState] = useState({ busyKey: "", studentId });
  const [codeState, setCodeState] = useState<{
    code: StudentCodeView;
    studentId: string;
  } | null>(null);
  const busyKey = busyState.studentId === studentId ? busyState.busyKey : "";
  const code = codeState?.studentId === studentId ? codeState.code : null;
  const versionRef = useRef(0);

  useEffect(() => {
    versionRef.current += 1;
    return () => {
      versionRef.current += 1;
    };
  }, [studentId]);

  function codeMessage(value: StudentCodeView) {
    const url = buildStudentAccessUrl(input.appOrigin, value.code);
    return {
      message: [
        value.label,
        formatContentText(adminStudentsText.codeModal.addressLine, { url }),
        formatContentText(adminStudentsText.codeModal.codeLine, {
          code: value.code,
        }),
      ].join("\n"),
      url,
    };
  }

  async function runCodeAction(kind: "reveal" | "rotate") {
    if (busyKey) return;
    if (
      kind === "rotate" &&
      !window.confirm(formatContentText(adminStudentsText.account.rotateConfirm, {
        student: input.student.displayName,
      }))
    ) {
      return;
    }
    const version = versionRef.current;
    setBusyState({ busyKey: kind, studentId });
    try {
      const payload = kind === "reveal"
        ? await revealStudentCode(input.student.id)
        : await rotateStudentCode(input.student.id);
      if (versionRef.current !== version) return;
      if (!payload.code) throw new Error(adminStudentsText.codeModal.missingCodeError);
      setCodeState({
        code: {
          code: payload.code,
          label: formatContentText(
            kind === "reveal"
              ? adminStudentsText.codeModal.revealTitle
              : adminStudentsText.codeModal.rotateTitle,
            { student: input.student.displayName },
          ),
        },
        studentId,
      });
      if (kind === "rotate") {
        toast.success(adminStudentsText.account.rotateSuccess);
        input.onUpdated();
      }
    } catch (error) {
      if (versionRef.current !== version) return;
      toast.error(
        error instanceof Error
          ? error.message
          : kind === "reveal"
            ? adminStudentsText.codeModal.revealError
            : adminStudentsText.account.rotateError,
      );
    } finally {
      if (versionRef.current === version) {
        setBusyState({ busyKey: "", studentId });
      }
    }
  }

  async function block() {
    if (
      busyKey ||
      !window.confirm(formatContentText(adminStudentsText.account.blockConfirm, {
        student: input.student.displayName,
      }))
    ) {
      return;
    }
    const version = versionRef.current;
    setBusyState({ busyKey: "block", studentId });
    try {
      await blockStudent(input.student.id);
      if (versionRef.current !== version) return;
      setCodeState(null);
      toast.success(adminStudentsText.account.blockSuccess);
      input.onUpdated();
    } catch (error) {
      if (versionRef.current === version) {
        toast.error(
          error instanceof Error
            ? error.message
            : adminStudentsText.account.blockError,
        );
      }
    } finally {
      if (versionRef.current === version) {
        setBusyState({ busyKey: "", studentId });
      }
    }
  }

  async function remove() {
    if (
      busyKey ||
      !window.confirm(formatContentText(adminStudentsText.account.deleteConfirm, {
        student: input.student.displayName,
      }))
    ) {
      return;
    }
    const version = versionRef.current;
    setBusyState({ busyKey: "delete", studentId });
    try {
      await deleteStudent(input.student.id);
      announceStudentRemoved(input.student.id);
      if (versionRef.current !== version) return;
      toast.success(adminStudentsText.account.deleteSuccess);
      input.onRemoved();
    } catch (error) {
      if (versionRef.current === version) {
        toast.error(
          error instanceof Error
            ? error.message
            : adminStudentsText.account.deleteError,
        );
      }
    } finally {
      if (versionRef.current === version) {
        setBusyState({ busyKey: "", studentId });
      }
    }
  }

  return {
    busyKey,
    code,
    interactionBusy: busyKey !== "",
    actions: {
      block,
      clearCode: () => setCodeState(null),
      copyCode: async () => {
        if (!code) return;
        await navigator.clipboard.writeText(code.code);
        toast.success(adminStudentsText.codeModal.copySuccess);
      },
      remove,
      revealCode: () => runCodeAction("reveal"),
      rotateCode: () => runCodeAction("rotate"),
      shareCode: async () => {
        if (!code) return "failed" as const;
        const { message, url } = codeMessage(code);
        const result = await sendKakaoText({
          message,
          title: code.label,
          url,
        });
        if (result !== "sent") await navigator.clipboard.writeText(message);
        return result;
      },
    },
  };
}

export type StudentAccessController = ReturnType<
  typeof useStudentAccessController
>;
