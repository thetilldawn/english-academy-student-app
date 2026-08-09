import type { Metadata } from "next";
import { z } from "zod";

import { AdminBreadcrumb } from "@/components/admin-breadcrumb";
import { AssignmentManager } from "@/components/assignment-manager";
import { ReviewAssignmentDialog } from "@/components/review-assignment-dialog";
import { adminLearningText } from "@/content/ko/admin-learning";
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
    student?: string | string[];
    reviewDraft?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const initialStudentId =
    typeof params.student === "string" ? params.student : "";
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
        <div className="notice notice-warm" role="status">
          {adminLearningText.page.expiredReviewDraft}
        </div>
      )}
      <AssignmentManager
        {...managerData}
        initialStudentId={requestedReviewDraftId ? "" : initialStudentId}
      />
      {reviewDraft && (
        <ReviewAssignmentDialog
          draft={reviewDraft}
          key={reviewDraft.id}
        />
      )}
    </>
  );
}
