"use client";

import { useRouter } from "next/navigation";

import { RoutedDetailDialog } from "@/components/routed-detail-dialog";
import { adminLearningText } from "@/content/ko/admin-learning";
import { adminHistoryText } from "@/content/ko/admin-history";
import { DetailHeader } from "@/design-system/patterns/detail-header/detail-header";
import { SingleAssignmentEditor } from "@/features/assignments/public-ui";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { Button } from "@/design-system/primitives/button/button";
import type { AdminHistoryDetail } from "../model";

import { AdminHistoryDetailContent } from "./admin-history-detail";
import { HistoryDetailActions } from "./history-detail-actions";
import { HistoryDetailHeader } from "./history-detail-header";
import { useEditableHistoryAssignment } from "@/features/history/controller/use-editable-history-assignment";

export function EditableHistoryDetailDialog({ detail }: { detail: AdminHistoryDetail }) {
  const router = useRouter();
  const editor = useEditableHistoryAssignment(detail);

  const heading = editor.editing ? (
    <DetailHeader
      subtitle={[
        detail.summary.studentName,
        detail.summary.schoolName || "학교 미입력",
      ].join(" · ")}
      title={adminLearningText.assignmentModal.header.editTitle}
      titleId="route-history-detail-title"
      titleRef={editor.editHeadingRef}
    />
  ) : (
    <HistoryDetailHeader
      detail={detail}
      titleId="route-history-detail-title"
    />
  );
  return (
    <RoutedDetailDialog
      closeDisabled={editor.editing && editor.editorBusy}
      closeLabel={adminHistoryText.detailModal.close}
      contentMode={editor.editing ? "structured" : "body"}
      height={editor.editing ? "large" : undefined}
      heading={heading}
      layout={editor.editing ? "body-footer" : "body"}
      routeCloseGuard={editor.editing ? editor.requestRouteExit : undefined}
      size={editor.editing ? "extra-wide" : "wide"}
      titleId="route-history-detail-title"
    >
      {editor.editing && editor.editorModel ? (
        <SingleAssignmentEditor
          {...editor.editorModel}
          editTarget={{
            assignmentId: detail.summary.assignmentId,
            purpose: editor.editorModel.initialEditDraft.purpose,
            studentId: detail.summary.studentId,
          }}
          formId={editor.formId}
          key={`${detail.summary.studentId}:${detail.summary.assignmentId}`}
          onBusyChange={editor.setEditorBusy}
          onConflict={() => router.refresh()}
          onSubmitPresentationChange={editor.setSubmitPresentation}
          onSucceeded={editor.handleSucceeded}
          placement="dialog"
          submitPlacement="footer"
        />
      ) : editor.editing ? (
        <div aria-busy={editor.loadStatus === "loading"} role="status">
          {editor.loadStatus === "error" ? (
            <Notice role="alert" tone="danger">
              {editor.loadError}
              <Button onClick={editor.retryLoad} size="small" variant="quiet">
                다시 불러오기
              </Button>
            </Notice>
          ) : (
            "수정 준비 자료를 불러오는 중…"
          )}
        </div>
      ) : (
        <AdminHistoryDetailContent
          actions={
            <HistoryDetailActions
              editButtonRef={editor.editButtonRef}
              item={detail.summary}
              mode="overlay"
              onEditRequested={editor.beginEditing}
            />
          }
          detail={detail}
        />
      )}
    </RoutedDetailDialog>
  );
}
