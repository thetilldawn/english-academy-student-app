import type { Metadata } from "next";

import { AdminBreadcrumb } from "@/components/admin-breadcrumb";
import { StudentManager } from "@/components/student-manager";
import { adminStudentsText } from "@/content/ko/admin-students";
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
  title: adminStudentsText.page.title,
};

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const [
    { student: initialStudentId = "" },
    students,
    datasets,
    assignmentDatasets,
    units,
    historyBundle,
    pendingReviewSummaries,
    currentVocabWrongSummaries,
    learningSources,
  ] = await Promise.all([
    searchParams,
    listStudents(),
    listSelectableDatasets(),
    listDatasets(),
    listVocabUnits(),
    listAssignmentHistoryBundle(),
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

  return (
    <>
      <AdminBreadcrumb current={adminStudentsText.page.title} />
      <StudentManager
        appOrigin={appOrigin}
        assignmentDatasets={assignmentDatasets}
        assignmentUnits={units}
        currentVocabWrongSummaries={currentVocabWrongSummaries}
        datasets={datasets}
        history={history}
        initialStudentId={initialStudentId}
        learningSources={learningSources}
        pendingReviewSummaries={pendingReviewSummaries}
        progress={progress}
        students={students}
        vocabBookHistory={vocabBookHistory}
      />
    </>
  );
}
