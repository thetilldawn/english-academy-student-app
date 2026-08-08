import type { Metadata } from "next";
import { z } from "zod";

import { AdminBreadcrumb } from "@/components/admin-breadcrumb";
import { AssignmentManager } from "@/components/assignment-manager";
import { ReviewAssignmentDialog } from "@/components/review-assignment-dialog";
import { adminLearningText } from "@/content/ko/admin-learning";
import {
  buildStudentProgress,
  listAssignmentHistory,
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
    history,
    pendingReviewSummaries,
    currentVocabWrongSummaries,
    learningSources,
    reviewDraft,
  ] = await Promise.all([
    listDatasets(),
    listStudents(),
    listVocabUnits(),
    listAssignmentHistory(),
    listStudentPendingReviewSummaries(),
    listStudentCurrentVocabWrongSummaries(),
    listStudentLearningSources(),
    requestedReviewDraftId && validReviewDraftId
      ? getReviewAssignmentDraftSummary(requestedReviewDraftId)
      : Promise.resolve(null),
  ]);
  const progress = buildStudentProgress(students, units, history);

  return (
    <>
      <AdminBreadcrumb
        current={adminLearningText.page.vocabularyTab}
        section={adminLearningText.page.title}
      />
      {requestedReviewDraftId && !reviewDraft && (
        <div className="notice notice-warm" role="status">
          재시험 초안이 만료되었거나 이미 사용되었습니다. 학생
          관리의 오답 탭에서 다시 선택해 주세요.
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
        history={history}
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
