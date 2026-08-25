"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { SingleAssignmentResult } from "@/features/assignments/controller/use-assignment-controller";
import { assignmentSubmitBlockerLabel } from "@/features/assignments/presentation/assignment-submit-blocker";
import type { SingleAssignmentSubmitPresentation } from "@/features/assignments/ui/single-assignment-editor.types";
import { historyDetailHref } from "@/lib/admin/history-route";
import type { AssignmentManagerData } from "@/lib/admin/assignment-manager-data";
import { useUnsavedChangesWarning } from "@/lib/ui/use-unsaved-changes-warning";
import type { AdminHistoryDetail } from "../model";

import { buildHistoryAssignmentEditorModel } from "./history-assignment-editor-model";

const initialSubmitPresentation = {
  blockedReason: assignmentSubmitBlockerLabel({ code: "loading" }),
  canSubmit: false,
  dirty: false,
};

export function useEditableHistoryAssignment(
  detail: AdminHistoryDetail,
  editorData: AssignmentManagerData | null,
) {
  const router = useRouter();
  const generatedId = useId().replaceAll(":", "");
  const formId = `history-assignment-edit-${generatedId}`;
  const [editing, setEditing] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [submitPresentation, setSubmitPresentation] =
    useState<SingleAssignmentSubmitPresentation | null>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const editHeadingRef = useRef<HTMLHeadingElement>(null);
  const restoreEditFocusRef = useRef(false);
  const editorModel = useMemo(
    () => buildHistoryAssignmentEditorModel(editorData, detail.summary),
    [detail.summary, editorData],
  );
  useUnsavedChangesWarning(
    editing && (Boolean(submitPresentation?.dirty) || editorBusy),
  );

  useEffect(() => {
    const target = editing
      ? editHeadingRef.current
      : restoreEditFocusRef.current
        ? editButtonRef.current
        : null;
    if (!target) return;
    if (!editing) restoreEditFocusRef.current = false;
    const animationFrame = window.requestAnimationFrame(() => target.focus());
    return () => window.cancelAnimationFrame(animationFrame);
  }, [editing]);

  function beginEditing() {
    if (!editorModel) return;
    restoreEditFocusRef.current = false;
    setSubmitPresentation(null);
    setEditing(true);
  }

  function closeEditor() {
    if (editorBusy) return;
    if (
      submitPresentation?.dirty &&
      !window.confirm("입력한 변경 내용을 버리고 닫을까요?")
    ) {
      return;
    }
    restoreEditFocusRef.current = true;
    setEditing(false);
    setSubmitPresentation(null);
  }

  function handleSucceeded(result: SingleAssignmentResult) {
    setEditing(false);
    setSubmitPresentation(null);
    if ("status" in result) {
      router.replace(
        historyDetailHref({
          assignmentId: result.replacementAssignmentId,
          attemptId: null,
          studentId: result.studentId,
        }),
        { scroll: false },
      );
    }
    router.refresh();
  }

  return {
    beginEditing,
    closeEditor,
    editing,
    editButtonRef,
    editHeadingRef,
    editorBusy,
    editorModel,
    formId,
    handleSucceeded,
    setEditorBusy,
    setSubmitPresentation,
    submitPresentation: submitPresentation ?? initialSubmitPresentation,
  };
}
