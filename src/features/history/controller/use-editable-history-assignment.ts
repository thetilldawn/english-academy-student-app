"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useRouteExitGuard } from "@/components/use-route-exit-guard";
import { adminHistoryText } from "@/content/ko/admin-history";
import { loadAssignmentEditContext } from "@/features/assignments/public-client";
import type {
  AssignmentEditContext,
  SingleAssignmentResult,
  SingleAssignmentSubmitPresentation,
} from "@/features/assignments/public-contracts";
import type { AdminHistoryDetail } from "@/features/history/model";
import { historyDetailHref } from "@/lib/admin/history-route";

type EditorLoadState = {
  context: AssignmentEditContext | null;
  error: string;
  status: "idle" | "loading" | "ready" | "error";
};

const idleEditorLoadState: EditorLoadState = {
  context: null,
  error: "",
  status: "idle",
};

const initialSubmitPresentation = {
  blockedReason: "수정 자료를 불러오는 중입니다.",
  canSubmit: false,
  dirty: false,
};

export function useEditableHistoryAssignment(detail: AdminHistoryDetail) {
  const router = useRouter();
  const generatedId = useId().replaceAll(":", "");
  const formId = `history-assignment-edit-${generatedId}`;
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorLoadState, setEditorLoadState] =
    useState<EditorLoadState>(idleEditorLoadState);
  const [submitPresentation, setSubmitPresentation] =
    useState<SingleAssignmentSubmitPresentation | null>(null);
  const editing = editorLoadState.status !== "idle";
  const setEditorContext = (context: AssignmentEditContext | null) =>
    setEditorLoadState((current) => ({ ...current, context }));
  const setLoadError = (error: string) =>
    setEditorLoadState((current) => ({ ...current, error }));
  const setLoadStatus = (status: EditorLoadState["status"]) =>
    setEditorLoadState((current) => ({ ...current, status }));
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const editHeadingRef = useRef<HTMLHeadingElement>(null);
  const restoreEditFocusRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
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

  useEffect(() => () => {
    requestVersionRef.current += 1;
    abortRef.current?.abort();
  }, []);

  async function loadContext() {
    requestVersionRef.current += 1;
    const requestVersion = requestVersionRef.current;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setLoadStatus("loading");
    setLoadError("");
    setEditorContext(null);
    try {
      const context = await loadAssignmentEditContext(
        {
          assignmentId: detail.summary.assignmentId,
          studentId: detail.summary.studentId,
        },
        abort.signal,
      );
      if (abort.signal.aborted || requestVersionRef.current !== requestVersion) return;
      setEditorContext(context);
      setLoadStatus("ready");
    } catch (error) {
      if (abort.signal.aborted || requestVersionRef.current !== requestVersion) return;
      setLoadError(
        error instanceof Error
          ? error.message
          : "수정 준비 자료를 불러오지 못했습니다.",
      );
      setLoadStatus("error");
    } finally {
      if (requestVersionRef.current === requestVersion) abortRef.current = null;
    }
  }

  function beginEditing() {
    restoreEditFocusRef.current = false;
    setSubmitPresentation(null);
    void loadContext();
  }

  function canCloseEditor() {
    return routeGuard.canExit();
  }

  function closeEditor() {
    if (!canCloseEditor()) return false;
    requestVersionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    restoreEditFocusRef.current = true;
    setEditorContext(null);
    setLoadStatus("idle");
    setLoadError("");
    setSubmitPresentation(null);
    return true;
  }

  function handleSucceeded(result: SingleAssignmentResult) {
    routeGuard.forceExit(() => {
      setEditorLoadState(idleEditorLoadState);
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
    editorModel: editorLoadState.context,
    formId,
    handleSucceeded,
    loadError: editorLoadState.error,
    loadStatus: editorLoadState.status,
    requestRouteExit: routeGuard.requestExit,
    retryLoad: () => void loadContext(),
    setEditorBusy,
    setSubmitPresentation,
    submitPresentation: submitPresentation ?? initialSubmitPresentation,
  };
}
