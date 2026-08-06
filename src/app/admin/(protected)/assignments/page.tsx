import type { Metadata } from "next";
import { z } from "zod";

import { AssignmentManagementList } from "@/components/assignment-management-list";
import { AssignmentManager } from "@/components/assignment-manager";
import { AdminHistoryList } from "@/components/admin-history-list";
import { ReviewAssignmentDialog } from "@/components/review-assignment-dialog";
import { ReviewDatasetPanel } from "@/components/review-dataset-panel";
import {
  buildStudentProgress,
  listAssignments,
  listAssignmentHistory,
  listDatasets,
  listReviewDatasets,
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
    assignments,
    history,
    pendingReviewSummaries,
    currentVocabWrongSummaries,
    reviewDraft,
    reviewDatasets,
  ] = await Promise.all([
    listDatasets(),
    listStudents(),
    listVocabUnits(),
    listAssignments(),
    listAssignmentHistory(),
    listStudentPendingReviewSummaries(),
    listStudentCurrentVocabWrongSummaries(),
    requestedReviewDraftId && validReviewDraftId
      ? getReviewAssignmentDraftSummary(requestedReviewDraftId)
      : Promise.resolve(null),
    listReviewDatasets(),
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
      <ReviewDatasetPanel datasets={reviewDatasets} />
      <AssignmentManager
        datasets={datasets}
        students={students}
        units={units}
        progress={progress}
        pendingReviewSummaries={pendingReviewSummaries}
        currentVocabWrongSummaries={currentVocabWrongSummaries}
        initialStudentId={requestedReviewDraftId ? "" : initialStudentId}
      />
      <section
        aria-labelledby="assignment-management-list"
        className="section"
      >
        <div className="section-heading">
          <div>
            <h2 id="assignment-management-list">시험별 관리</h2>
            <p className="list-meta">
              테스트로 만든 시험을 포함해 시험 전체를 한 번에
              삭제합니다.
            </p>
          </div>
        </div>
        <AssignmentManagementList items={assignments} />
      </section>
      <section
        aria-labelledby="assignment-management-history"
        className="section"
      >
        <div className="section-heading">
          <div>
            <h2 id="assignment-management-history">배정 관리</h2>
            <p className="list-meta">
              학생별 배정 취소와 개별 내역 삭제를 관리합니다.
            </p>
          </div>
        </div>
        <AdminHistoryList items={history} showFilters />
      </section>
      {reviewDraft && (
        <ReviewAssignmentDialog
          draft={reviewDraft}
          key={reviewDraft.id}
        />
      )}
    </>
  );
}
