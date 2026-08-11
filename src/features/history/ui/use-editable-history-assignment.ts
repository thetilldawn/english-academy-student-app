"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { SingleAssignmentResult } from "@/features/assignments/controller/use-assignment-controller";
import { assignmentSubmitBlockerLabel } from "@/features/assignments/presentation/assignment-submit-blocker";
import type { SingleAssignmentSubmitPresentation } from "@/features/assignments/ui/single-assignment-editor";
import { historyDetailHref } from "@/lib/admin/history-route";
import type { AdminHistoryDetail } from "@/lib/services/admin-service";
import type { AssignmentManagerData } from "@/lib/services/assignment-manager-data";

import { buildHistoryAssignmentEditorModel } from "./history-assignment-editor-model";

const initialSubmitPresentation = {
  blockedReason: assignmentSubmitBlockerLabel({ code: "loading" }),
  canSubmit: false,
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
