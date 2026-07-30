import type { Metadata } from "next";
import { z } from "zod";

import { AssignmentManager } from "@/components/assignment-manager";
import { ReviewAssignmentDialog } from "@/components/review-assignment-dialog";
import {
  buildStudentProgress,
  listAssignmentHistory,
  listDatasets,
  listStudentCurrentVocabWrongSummaries,
  listStudentPendingReviewSummaries,
  listStudents,
  listVocabUnits,
} from "@/lib/services/admin-service";
import { getReviewAssignmentDraftSummary } from "@/lib/services/review-assignment-service";

export const metadata: Metadata = {
  title: "시험 관리",
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
    reviewDraft,
  ] = await Promise.all([
    listDatasets(),
    listStudents(),
    listVocabUnits(),
    listAssignmentHistory(),
    listStudentPendingReviewSummaries(),
    listStudentCurrentVocabWrongSummaries(),
    requestedReviewDraftId && validReviewDraftId
      ? getReviewAssignmentDraftSummary(requestedReviewDraftId)
      : Promise.resolve(null),
  ]);
  const progress = buildStudentProgress(students, units, history);

  return (
    <>
      <div className="page-heading admin-page-heading">
        <div>
          <p className="eyebrow">TEST MANAGEMENT</p>
          <h1>시험 관리</h1>
          <p>
            학생을 찾고 최근 상태를 확인한 뒤 필요한 시험을
            배정합니다.
          </p>
        </div>
      </div>
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
