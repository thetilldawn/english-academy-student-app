import type { Metadata } from "next";

import { AdminBreadcrumb } from "@/components/admin-breadcrumb";
import { OverviewActionGroups } from "@/components/overview-action-groups";
import { overviewActivityGroups } from "@/lib/admin/learning-activity";
import { getServerEnvironment } from "@/lib/env";
import {
  buildStudentProgress,
  listAssignmentHistory,
  listDatasets,
  listSelectableDatasets,
  listStudentCurrentVocabWrongSummaries,
  listStudentLearningSources,
  listStudentPendingReviewSummaries,
  listStudents,
  listVocabUnits,
} from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: "Overview",
};

export default async function AdminDashboardPage() {
  const [
    history,
    students,
    datasets,
    assignmentDatasets,
    units,
    pendingReviewSummaries,
    currentVocabWrongSummaries,
    learningSources,
  ] = await Promise.all([
    listAssignmentHistory(),
    listStudents(),
    listSelectableDatasets(),
    listDatasets(),
    listVocabUnits(),
    listStudentPendingReviewSummaries(),
    listStudentCurrentVocabWrongSummaries(),
    listStudentLearningSources(),
  ]);
  const progress = buildStudentProgress(students, units, history);
  const appOrigin =
    getServerEnvironment().APP_ORIGIN ?? "http://localhost:3000";
  const groups = overviewActivityGroups(history);
  const sections = [
    {
      id: "missed",
      title: "미응시 마감",
      description: "마감까지 시작하지 않은 학습",
      items: groups.missed,
    },
    {
      id: "failed",
      title: "미통과·재시험 필요",
      description: "통과 기준에 도달하지 못한 학습",
      items: groups.failed,
    },
    {
      id: "due-soon",
      title: "곧 마감",
      description: "가까운 마감부터",
      items: groups.dueSoon,
    },
    {
      id: "no-deadline",
      title: "마감 없음",
      description: "오래 배정된 학습부터",
      items: groups.noDeadline,
    },
  ].filter((section) => section.items.length > 0);

  return (
    <>
      <AdminBreadcrumb current="Overview" />
      {sections.length === 0 ? (
        <div className="empty-state overview-clear-state">
          지금 확인할 미응시·미통과·대기 학습이 없습니다.
        </div>
      ) : (
        <OverviewActionGroups
          sections={sections}
          studentManagerProps={{
            appOrigin,
            assignmentDatasets,
            assignmentUnits: units,
            currentVocabWrongSummaries,
            datasets,
            history,
            learningSources,
            pendingReviewSummaries,
            progress,
            students,
          }}
        />
      )}
    </>
  );
}
