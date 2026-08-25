import { buildStudentProgress } from "@/lib/admin/progress";
import { listAssignmentHistoryBundle } from "@/lib/services/admin-history-read-service";
import {
  listStudentCurrentVocabWrongSummaries,
  listStudentClassGroups,
  listStudentPendingReviewSummaries,
  loadStudentDirectoryBundle,
} from "@/lib/services/admin-student-read-service";
import { listVocabTimeTemplates } from "@/lib/services/vocab-time-template-service";
import { listVocabAssignmentQueueSummaries } from "@/lib/services/vocab-assignment-queue-service";
import type { AssignmentManagerData } from "@/lib/admin/assignment-manager-data";

export async function loadAssignmentManagerData(options?: {
  finalizeStale?: boolean;
  reuseMaterialRequestCache?: boolean;
}): Promise<
  AssignmentManagerData
> {
  const [
    directory,
    historyBundle,
    pendingReviewSummaries,
    currentVocabWrongSummaries,
    classGroups,
    timeTemplates,
    assignmentQueues,
  ] = await Promise.all([
    loadStudentDirectoryBundle(),
    listAssignmentHistoryBundle({
      finalizeStale: options?.finalizeStale ?? false,
      reuseMaterialRequestCache:
        options?.reuseMaterialRequestCache ?? true,
    }),
    listStudentPendingReviewSummaries(),
    listStudentCurrentVocabWrongSummaries(),
    listStudentClassGroups(),
    listVocabTimeTemplates(),
    listVocabAssignmentQueueSummaries(),
  ]);
  const {
    allDatasets: datasets,
    assignmentUnits: units,
    learningSources,
    students,
  } = directory;

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
