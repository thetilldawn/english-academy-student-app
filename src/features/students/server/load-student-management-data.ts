import "server-only";

import { buildStudentVocabBookHistory } from "@/lib/admin/student-vocab-book-history";
import { getServerEnvironment } from "@/lib/env";
import {
  buildStudentProgress,
  listAssignmentHistoryBundle,
  listStudentCurrentVocabWrongSummaries,
  loadStudentDirectoryBundle,
  listStudentPendingReviewSummaries,
  listVocabUnits,
} from "@/lib/services/admin-service";

import type { StudentManagementData } from "../model";

export async function loadStudentManagementData(): Promise<
  Omit<StudentManagementData, "initialStudentId">
> {
  const [
    directory,
    assignmentUnits,
    historyBundle,
    pendingReviewSummaries,
    currentVocabWrongSummaries,
  ] = await Promise.all([
    loadStudentDirectoryBundle(),
    listVocabUnits(),
    listAssignmentHistoryBundle(),
    listStudentPendingReviewSummaries(),
    listStudentCurrentVocabWrongSummaries(),
  ]);
  const history = historyBundle.history;

  return {
    appOrigin:
      getServerEnvironment().APP_ORIGIN ?? "http://localhost:3000",
    assignmentDatasets: directory.allDatasets,
    assignmentUnits,
    currentHistory: historyBundle.currentHistory,
    currentVocabWrongSummaries,
    datasets: directory.selectableDatasets,
    history,
    learningSources: directory.learningSources,
    pendingReviewSummaries,
    progress: buildStudentProgress(
      directory.students,
      assignmentUnits,
      historyBundle.completeHistory,
    ),
    students: directory.students,
    vocabBookHistory: buildStudentVocabBookHistory(
      historyBundle.completeHistory,
      new Map(assignmentUnits.map((unit) => [unit.id, unit.displayName])),
    ),
  };
}
