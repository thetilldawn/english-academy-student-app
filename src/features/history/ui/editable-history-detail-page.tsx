"use client";

import { useRouter } from "next/navigation";

import { adminHistoryText } from "@/content/ko/admin-history";
import { adminLearningText } from "@/content/ko/admin-learning";
import { DetailHeader } from "@/design-system/patterns/detail-header/detail-header";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { SingleAssignmentEditor } from "@/features/assignments/public-ui";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import type { AdminHistoryDetail } from "../model";

import { AdminHistoryDetailContent } from "./admin-history-detail";
import { HistoryDetailActions } from "./history-detail-actions";
import {
  HistoryDetailPageHeader,
  HistoryDetailPageHeaderFrame,
} from "./history-detail-header";
import { useEditableHistoryAssignment } from "@/features/history/controller/use-editable-history-assignment";

export function EditableHistoryDetailPage({ detail }: { detail: AdminHistoryDetail }) {
  const router = useRouter();
  const editor = useEditableHistoryAssignment(detail);

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
            subtitle={[
              detail.summary.studentName,
              detail.summary.schoolName || "학교 미입력",
            ].join(" · ")}
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
            purpose: editor.editorModel.initialEditDraft.purpose,
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
