import type { Metadata } from "next";
import { z } from "zod";

import { AdminBreadcrumb } from "@/components/admin-breadcrumb";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { adminLearningText } from "@/content/ko/admin-learning";
import { AssignmentWorkspace } from "@/features/assignments/ui/assignment-workspace";
import { LegacyReviewRecovery } from "@/features/assignments/ui/legacy-review-recovery";
import {
  loadAssignmentManagerData,
} from "@/lib/services/assignment-manager-data";
import { getReviewAssignmentDraftSummary } from "@/lib/services/review-assignment-service";

export const metadata: Metadata = {
  title: adminLearningText.page.title,
};
export const dynamic = "force-dynamic";

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    dataset?: string | string[];
    reviewDraft?: string | string[];
    student?: string | string[];
    view?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const initialDatasetId =
    typeof params.dataset === "string" ? params.dataset : "";
  const initialStudentId =
    typeof params.student === "string" ? params.student : "";
  const initialDialogView = params.view === "assign" ? "assign" : "overview";
  const requestedReviewDraftId =
    typeof params.reviewDraft === "string" ? params.reviewDraft : "";
  const validReviewDraftId = z
    .uuid()
    .safeParse(requestedReviewDraftId).success;
  const [managerData, reviewDraft] = await Promise.all([
    loadAssignmentManagerData(),
    requestedReviewDraftId && validReviewDraftId
      ? getReviewAssignmentDraftSummary(requestedReviewDraftId)
      : Promise.resolve(null),
  ]);

  return (
    <>
      <AdminBreadcrumb
        current={adminLearningText.page.vocabularyTab}
        section={adminLearningText.page.title}
      />
      {requestedReviewDraftId && !reviewDraft && (
        <Notice role="status" tone="warning">
          {adminLearningText.page.expiredReviewDraft}
        </Notice>
      )}
      <AssignmentWorkspace
        data={managerData}
        initialDatasetId={initialDatasetId}
        initialDialogView={initialDialogView}
        initialStudentId={requestedReviewDraftId ? "" : initialStudentId}
        key={
          requestedReviewDraftId
            ? `legacy-review:${requestedReviewDraftId}`
            : `assignment-workspace:${initialStudentId}:${initialDatasetId}:${initialDialogView}`
        }
      />
      {reviewDraft && (
        <LegacyReviewRecovery draft={reviewDraft} key={reviewDraft.id} />
      )}
    </>
  );
}
