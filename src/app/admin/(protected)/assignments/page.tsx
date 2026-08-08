import type { Metadata } from "next";
import { z } from "zod";

import { AdminBreadcrumb } from "@/components/admin-breadcrumb";
import { AssignmentManager } from "@/components/assignment-manager";
import { ReviewAssignmentDialog } from "@/components/review-assignment-dialog";
import { adminLearningText } from "@/content/ko/admin-learning";
import {
  buildStudentProgress,
  listAssignmentHistoryBundle,
  listDatasets,
  listStudentCurrentVocabWrongSummaries,
  listStudentLearningSources,
  listStudentPendingReviewSummaries,
  listStudents,
  listVocabUnits,
} from "@/lib/services/admin-service";
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
  const [
    datasets,
    students,
    units,
    historyBundle,
    pendingReviewSummaries,
    currentVocabWrongSummaries,
    learningSources,
    reviewDraft,
  ] = await Promise.all([
    listDatasets(),
    listStudents(),
    listVocabUnits(),
    listAssignmentHistoryBundle(),
    listStudentPendingReviewSummaries(),
    listStudentCurrentVocabWrongSummaries(),
    listStudentLearningSources(),
    requestedReviewDraftId && validReviewDraftId
      ? getReviewAssignmentDraftSummary(requestedReviewDraftId)
      : Promise.resolve(null),
  ]);
  const progress = buildStudentProgress(
    students,
    units,
    historyBundle.history,
  );

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
        datasets={datasets}
        students={students}
        units={units}
        progress={progress}
        pendingReviewSummaries={pendingReviewSummaries}
        currentVocabWrongSummaries={currentVocabWrongSummaries}
        learningSources={learningSources}
        history={historyBundle.currentHistory}
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
