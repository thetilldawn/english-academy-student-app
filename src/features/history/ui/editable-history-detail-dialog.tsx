"use client";

import { useRouter } from "next/navigation";

import { adminLearningText } from "@/content/ko/admin-learning";
import { DetailHeader } from "@/design-system/patterns/detail-header/detail-header";
import { SingleAssignmentEditor } from "@/features/assignments/ui/single-assignment-editor";
import { AssignmentSubmitAction } from "@/features/assignments/ui/assignment-submit-action";
import type { AdminHistoryDetail } from "@/lib/services/admin-service";
import type { AssignmentManagerData } from "@/lib/services/assignment-manager-data";

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
      subtitle={detail.summary.studentName}
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
  const headerActions = editor.editing ? (
    <AssignmentSubmitAction
      blockedReason={editor.submitPresentation.blockedReason}
      canSubmit={editor.submitPresentation.canSubmit}
      formId={editor.formId}
      label={
        editor.editorBusy
          ? adminLearningText.assignmentModal.submit.saving
          : adminLearningText.assignmentModal.submit.headerSaveChanges
      }
      size="small"
    />
  ) : undefined;

  return (
    <RouteDetailDialog
      closeDisabled={editor.editing && editor.editorBusy}
      contentMode={editor.editing ? "structured" : "body"}
      heading={heading}
      headerActions={headerActions}
      onRequestClose={editor.editing ? editor.closeEditor : undefined}
    >
      {editor.editing && editor.editorModel ? (
        <SingleAssignmentEditor
          {...editor.editorModel}
          editTarget={{
            assignmentId: detail.summary.assignmentId,
            studentId: detail.summary.studentId,
          }}
          formId={editor.formId}
          key={`${detail.summary.studentId}:${detail.summary.assignmentId}`}
          onBusyChange={editor.setEditorBusy}
          onConflict={() => router.refresh()}
          onSubmitPresentationChange={editor.setSubmitPresentation}
          onSucceeded={editor.handleSucceeded}
          placement="dialog"
          submitPlacement="external"
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
