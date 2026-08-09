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

export async function loadAssignmentManagerData() {
  const [
    datasets,
    students,
    units,
    historyBundle,
    pendingReviewSummaries,
    currentVocabWrongSummaries,
    learningSources,
  ] = await Promise.all([
    listDatasets(),
    listStudents(),
    listVocabUnits(),
    listAssignmentHistoryBundle(),
    listStudentPendingReviewSummaries(),
    listStudentCurrentVocabWrongSummaries(),
    listStudentLearningSources(),
  ]);

  return {
    datasets,
    students,
    units,
    history: historyBundle.currentHistory,
    progress: buildStudentProgress(students, units, historyBundle.history),
    pendingReviewSummaries,
    currentVocabWrongSummaries,
    learningSources,
  };
}

export type AssignmentManagerData = Awaited<
  ReturnType<typeof loadAssignmentManagerData>
>;
