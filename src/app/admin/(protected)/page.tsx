import type { Metadata } from "next";

import { AdminBreadcrumb } from "@/components/admin-breadcrumb";
import { OverviewActionGroups } from "@/components/overview-action-groups";
import { overviewActivityGroups } from "@/lib/admin/learning-activity";
import { getServerEnvironment } from "@/lib/env";
import {
  buildStudentProgress,
  listAssignmentHistoryBundle,
  listDatasets,
  listSelectableDatasets,
  listStudentCurrentVocabWrongSummaries,
  listStudentLearningSources,
  listStudentPendingReviewSummaries,
  listStudents,
  listVocabUnits,
} from "@/lib/services/admin-service";
import { buildStudentVocabBookHistory } from "@/lib/admin/student-vocab-book-history";

export const metadata: Metadata = {
  title: "Overview",
};

export default async function AdminDashboardPage() {
  const [
    historyBundle,
    students,
    datasets,
    assignmentDatasets,
    units,
    pendingReviewSummaries,
    currentVocabWrongSummaries,
    learningSources,
  ] = await Promise.all([
    listAssignmentHistoryBundle(),
    listStudents(),
    listSelectableDatasets(),
    listDatasets(),
    listVocabUnits(),
    listStudentPendingReviewSummaries(),
    listStudentCurrentVocabWrongSummaries(),
    listStudentLearningSources(),
  ]);
  const history = historyBundle.history;
  const vocabBookHistory = buildStudentVocabBookHistory(
    historyBundle.completeHistory,
    new Map(units.map((unit) => [unit.id, unit.displayName])),
  );
  const progress = buildStudentProgress(students, units, history);
  const appOrigin =
    getServerEnvironment().APP_ORIGIN ?? "http://localhost:3000";
  const groups = overviewActivityGroups(history);
  const sections = [
    {
      id: "missed",
      title: "미응시 마감",
      items: groups.missed,
    },
    {
      id: "failed",
      title: "미통과·재시험 필요",
      items: groups.failed,
    },
    {
      id: "due-soon",
      title: "곧 마감",
      items: groups.dueSoon,
    },
    {
      id: "no-deadline",
      title: "마감 없음",
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
            vocabBookHistory,
          }}
        />
      )}
    </>
  );
}
