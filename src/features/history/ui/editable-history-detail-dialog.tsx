"use client";

import { useRouter } from "next/navigation";

import { adminLearningText } from "@/content/ko/admin-learning";
import { DetailHeader } from "@/design-system/patterns/detail-header/detail-header";
import { SingleAssignmentEditor } from "@/features/assignments/ui/single-assignment-editor";
import type { AssignmentManagerData } from "@/lib/admin/assignment-manager-data";
import type { AdminHistoryDetail } from "../model";

import { AdminHistoryDetailContent } from "./admin-history-detail";
import { HistoryDetailActions } from "./history-detail-actions";
import { HistoryDetailHeader } from "./history-detail-header";
import { RouteDetailDialog } from "./route-detail-dialog";
import { useEditableHistoryAssignment } from "./use-editable-history-assignment";

export function EditableHistoryDetailDialog({
  detail,
  editorData,
}: {
  detail: AdminHistoryDetail;
  editorData: AssignmentManagerData | null;
}) {
  const router = useRouter();
  const editor = useEditableHistoryAssignment(detail, editorData);

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
    <RouteDetailDialog
      beforeRouteClose={editor.editing ? editor.canCloseEditor : undefined}
      closeDisabled={editor.editing && editor.editorBusy}
      contentMode={editor.editing ? "structured" : "body"}
      height={editor.editing ? "large" : undefined}
      heading={heading}
      layout={editor.editing ? "body-footer" : "body"}
      size={editor.editing ? "extra-wide" : "wide"}
    >
      {editor.editing && editor.editorModel ? (
        <SingleAssignmentEditor
          {...editor.editorModel}
          editTarget={{
            assignmentId: detail.summary.assignmentId,
            purpose: detail.summary.assignmentPurpose,
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
      ) : (
        <AdminHistoryDetailContent
          actions={
            <HistoryDetailActions
              editorData={editorData}
              editButtonRef={editor.editButtonRef}
              item={detail.summary}
              mode="overlay"
              onEditRequested={editor.beginEditing}
            />
          }
          detail={detail}
        />
      )}
    </RouteDetailDialog>
  );
}
