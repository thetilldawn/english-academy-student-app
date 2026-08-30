"use client";

import { useState } from "react";
import { toast } from "sonner";

import { formatContentText } from "@/content/format";
import { adminStudentsText } from "@/content/ko/admin-students";
import { buildStudentAccessUrl } from "@/lib/auth/student-code-input";
import { sendKakaoText } from "@/lib/kakao-share";

import { createStudent } from "../api/student-mutations";
import type { StudentCodeView } from "../contracts/student-detail-read-model";
import { announceStudentDirectoryRefresh } from "./student-directory-events";

export function useStudentCreationController(appOrigin: string) {
  const [code, setCode] = useState<StudentCodeView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(formElement: HTMLFormElement) {
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(formElement);
    try {
      const displayName = String(form.get("displayName") ?? "");
      const payload = await createStudent({
        currentVocabDatasetId: form.get("currentVocabDatasetId"),
        displayName,
        gradeLabel: form.get("gradeLabel"),
        note: form.get("note"),
        schoolName: form.get("schoolName"),
      });
      if (!payload.code) {
        throw new Error(adminStudentsText.createStudent.noCodeError);
      }
      setCode({
        code: payload.code,
        label: formatContentText(adminStudentsText.createStudent.codeTitle, {
          student: displayName,
        }),
      });
      toast.success(adminStudentsText.createStudent.success);
      formElement.reset();
      announceStudentDirectoryRefresh();
    } catch (requestError) {
      const message = requestError instanceof Error
        ? requestError.message
        : adminStudentsText.createStudent.error;
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  function codeMessage(value: StudentCodeView) {
    const url = buildStudentAccessUrl(appOrigin, value.code);
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

  return {
    busy,
    code,
    error,
    actions: {
      closeCode: () => setCode(null),
      copyCode: async () => {
        if (!code) return;
        await navigator.clipboard.writeText(code.code);
      },
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
      submit,
    },
  };
}

export type StudentCreationController = ReturnType<
  typeof useStudentCreationController
>;
