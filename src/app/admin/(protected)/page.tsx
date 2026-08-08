import type { Metadata } from "next";

import { AdminBreadcrumb } from "@/components/admin-breadcrumb";
import { OverviewActionGroups } from "@/components/overview-action-groups";
import { adminOverviewText } from "@/content/ko/admin-overview";
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
  title: adminOverviewText.page.title,
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
      title: adminOverviewText.sections.missed,
      items: groups.missed,
    },
    {
      id: "failed",
      title: adminOverviewText.sections.failed,
      items: groups.failed,
    },
    {
      id: "due-soon",
      title: adminOverviewText.sections.dueSoon,
      items: groups.dueSoon,
    },
    {
      id: "no-deadline",
      title: adminOverviewText.sections.noDeadline,
      items: groups.noDeadline,
    },
  ].filter((section) => section.items.length > 0);

  return (
    <>
      <AdminBreadcrumb current={adminOverviewText.page.title} />
      {sections.length === 0 ? (
        <div className="empty-state overview-clear-state">
          {adminOverviewText.emptyState}
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
