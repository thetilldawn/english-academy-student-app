import type { Metadata } from "next";
import { z } from "zod";

import { Notice } from "@/design-system/patterns/feedback/feedback";
import { adminLearningText } from "@/content/ko/admin-learning";
import { AssignmentWorkspace } from "@/features/assignments/ui/assignment-workspace";
import { LegacyReviewRecovery } from "@/features/assignments/ui/legacy-review-recovery";
import { getStudentDirectoryInitial } from "@/features/students/public-server";
import { emptyStudentDirectoryFilters } from "@/features/students/public-contracts";
import { getReviewAssignmentDraftSummary } from "@/lib/services/review-assignment-draft-query";

export const metadata: Metadata = {
  title: adminLearningText.page.vocabularyTab,
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
  const [directory, reviewDraft] = await Promise.all([
    getStudentDirectoryInitial({
      filters: { ...emptyStudentDirectoryFilters, status: "active" },
    }),
    requestedReviewDraftId && validReviewDraftId
      ? getReviewAssignmentDraftSummary(requestedReviewDraftId)
      : Promise.resolve(null),
  ]);

  return (
    <>
      {requestedReviewDraftId && !reviewDraft && (
        <Notice role="status" tone="warning">
          {adminLearningText.page.expiredReviewDraft}
        </Notice>
      )}
      <AssignmentWorkspace
        initial={{ directory }}
        initialDatasetId={initialDatasetId}
        initialDialogView={initialDialogView}
        initialStudentId={requestedReviewDraftId ? "" : initialStudentId}
        key={
          requestedReviewDraftId
            ? `legacy-review:${requestedReviewDraftId}`
            : `assignment-workspace:${directory.snapshotAt}:${initialStudentId}:${initialDatasetId}:${initialDialogView}`
        }
      />
      {reviewDraft && (
        <LegacyReviewRecovery draft={reviewDraft} key={reviewDraft.id} />
      )}
    </>
  );
}
