"use client";

import { useRouter } from "next/navigation";

import { adminHistoryText } from "@/content/ko/admin-history";
import { adminLearningText } from "@/content/ko/admin-learning";
import { DetailHeader } from "@/design-system/patterns/detail-header/detail-header";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { SingleAssignmentEditor } from "@/features/assignments/ui/single-assignment-editor";
import type { AdminHistoryDetail } from "@/lib/services/admin-service";
import type { AssignmentManagerData } from "@/lib/services/assignment-manager-data";

import { AdminHistoryDetailContent } from "./admin-history-detail";
import { HistoryDetailActions } from "./history-detail-actions";
import {
  HistoryDetailPageHeader,
  HistoryDetailPageHeaderFrame,
} from "./history-detail-header";
import { useEditableHistoryAssignment } from "./use-editable-history-assignment";

export function EditableHistoryDetailPage({
  detail,
  editorData,
}: {
  detail: AdminHistoryDetail;
  editorData: AssignmentManagerData | null;
}) {
  const router = useRouter();
  const editor = useEditableHistoryAssignment(detail, editorData);

  return (
    <div>
      {editor.editing ? (
        <HistoryDetailPageHeaderFrame
          actions={
            <Button
              disabled={editor.editorBusy}
              onClick={editor.closeEditor}
              size="small"
              variant="quiet"
            >
              {adminHistoryText.detailModal.close}
            </Button>
          }
        >
          <DetailHeader
            subtitle={detail.summary.studentName}
            title={adminLearningText.assignmentModal.header.editTitle}
            titleId="history-detail-page-title"
            titleRef={editor.editHeadingRef}
          />
        </HistoryDetailPageHeaderFrame>
      ) : (
        <HistoryDetailPageHeader
          actions={
            <ButtonLink href="/admin/results" variant="quiet">
              {adminHistoryText.resultDetail.backToResults}
            </ButtonLink>
          }
          detail={detail}
          titleId="history-detail-page-title"
        />
      )}

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
          placement="inline"
          submitPlacement="footer"
        />
      ) : (
        <AdminHistoryDetailContent
          actions={
            <HistoryDetailActions
              editorData={editorData}
              editButtonRef={editor.editButtonRef}
              item={detail.summary}
              mode="page"
              onEditRequested={editor.beginEditing}
            />
          }
          detail={detail}
        />
      )}
    </div>
  );
}
