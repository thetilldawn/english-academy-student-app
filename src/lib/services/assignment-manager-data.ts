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
import { listVocabAssignmentQueueSummaries } from "@/lib/services/vocab-assignment-queue-service";
import type { AssignmentManagerData } from "@/lib/admin/assignment-manager-data";

export async function loadAssignmentManagerData(): Promise<
  AssignmentManagerData
> {
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
    assignmentQueues,
  ] = await Promise.all([
    listDatasets(),
    listStudents(),
    listVocabUnits(),
    listAssignmentHistoryBundle({ finalizeStale: false }),
    listStudentPendingReviewSummaries(),
    listStudentCurrentVocabWrongSummaries(),
    listStudentLearningSources(),
    listStudentClassGroups(),
    listVocabTimeTemplates(),
    listVocabAssignmentQueueSummaries(),
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
    assignmentQueues,
  };
}
