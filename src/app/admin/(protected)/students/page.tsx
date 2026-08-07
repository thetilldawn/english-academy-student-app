import type { Metadata } from "next";

import { AdminBreadcrumb } from "@/components/admin-breadcrumb";
import { StudentManager } from "@/components/student-manager";
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
  title: "학생 관리",
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
    history,
    pendingReviewSummaries,
    currentVocabWrongSummaries,
    learningSources,
  ] = await Promise.all([
    searchParams,
    listStudents(),
    listSelectableDatasets(),
    listDatasets(),
    listVocabUnits(),
    listAssignmentHistory(),
    listStudentPendingReviewSummaries(),
    listStudentCurrentVocabWrongSummaries(),
    listStudentLearningSources(),
  ]);
  const progress = buildStudentProgress(students, units, history);
  const appOrigin =
    getServerEnvironment().APP_ORIGIN ?? "http://localhost:3000";

  return (
    <>
      <AdminBreadcrumb current="학생 관리" />
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
      />
    </>
  );
}
