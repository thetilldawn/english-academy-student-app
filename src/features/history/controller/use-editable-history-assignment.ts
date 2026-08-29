"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useRouteExitGuard } from "@/components/use-route-exit-guard";
import { adminHistoryText } from "@/content/ko/admin-history";
import type { SingleAssignmentResult } from "@/features/assignments/controller/use-assignment-controller";
import { assignmentSubmitBlockerLabel } from "@/features/assignments/presentation/assignment-submit-blocker";
import type { SingleAssignmentSubmitPresentation } from "@/features/assignments/ui/single-assignment-editor.types";
import type { AdminHistoryDetail } from "@/features/history/model";
import { buildHistoryAssignmentEditorModel } from "@/features/history/ui/history-assignment-editor-model";
import { historyDetailHref } from "@/lib/admin/history-route";
import type { AssignmentManagerData } from "@/lib/admin/assignment-manager-data";

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
  const routeGuard = useRouteExitGuard({
    busy: editing && editorBusy,
    confirmMessage: adminHistoryText.detailModal.discardChangesConfirm,
    dirty: editing && Boolean(submitPresentation?.dirty),
    idPrefix: "history-assignment-edit",
  });

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

  function canCloseEditor() {
    return routeGuard.canExit();
  }

  function closeEditor() {
    if (!canCloseEditor()) return false;
    restoreEditFocusRef.current = true;
    setEditing(false);
    setSubmitPresentation(null);
    return true;
  }

  function handleSucceeded(result: SingleAssignmentResult) {
    routeGuard.forceExit(() => {
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
        return;
      }
      router.refresh();
    });
  }

  return {
    beginEditing,
    canCloseEditor,
    closeEditor,
    editing,
    editButtonRef,
    editHeadingRef,
    editorBusy,
    editorModel,
    formId,
    handleSucceeded,
    requestRouteExit: routeGuard.requestExit,
    setEditorBusy,
    setSubmitPresentation,
    submitPresentation: submitPresentation ?? initialSubmitPresentation,
  };
}
