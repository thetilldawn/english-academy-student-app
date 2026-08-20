import {
  buildStudentProgress,
  listAssignmentHistoryBundle,
  listDatasets,
  listStudentCurrentVocabWrongSummaries,
  listStudentClassGroups,
  listStudentLearningSources,
  listStudentPendingReviewSummaries,
  listStudents,
  listVocabUnits,
} from "@/lib/services/admin-service";
import { listVocabTimeTemplates } from "@/lib/services/vocab-time-template-service";

export async function loadAssignmentManagerData() {
  const [
    datasets,
    students,
    units,
    historyBundle,
    pendingReviewSummaries,
    currentVocabWrongSummaries,
    learningSources,
    classGroups,
    timeTemplates,
  ] = await Promise.all([
    listDatasets(),
    listStudents(),
    listVocabUnits(),
    listAssignmentHistoryBundle(),
    listStudentPendingReviewSummaries(),
    listStudentCurrentVocabWrongSummaries(),
    listStudentLearningSources(),
    listStudentClassGroups(),
    listVocabTimeTemplates(),
  ]);

  return {
    datasets,
    students,
    units,
    history: historyBundle.currentHistory,
    progress: buildStudentProgress(
      students,
      units,
      historyBundle.completeHistory,
    ),
    pendingReviewSummaries,
    currentVocabWrongSummaries,
    learningSources,
    classGroups,
    timeTemplates,
  };
}

export type AssignmentManagerData = Awaited<
  ReturnType<typeof loadAssignmentManagerData>
>;
