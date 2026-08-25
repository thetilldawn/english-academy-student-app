import "server-only";

import { buildStudentVocabBookHistory } from "@/lib/admin/student-vocab-book-history";
import { getAppOrigin } from "@/lib/env";
import {
  listAssignmentHistoryBundle,
} from "@/lib/services/admin-history-read-service";
import { buildStudentProgress } from "@/lib/admin/progress";
import {
  listStudentCurrentVocabWrongSummaries,
  loadStudentDirectoryBundle,
  listStudentPendingReviewSummaries,
} from "@/lib/services/admin-student-read-service";
import { listStudentPointBalances } from "@/lib/services/learning-point-read-service";

import type { StudentManagementData } from "../model";

export async function loadStudentManagementData(): Promise<
  Omit<StudentManagementData, "initialStudentId">
> {
  const directoryPromise = loadStudentDirectoryBundle();
  const pointBalancesPromise = directoryPromise.then(async (directory) =>
    Object.fromEntries(
      await listStudentPointBalances(
        directory.students.map((student) => student.id),
      ),
    ),
  );
  const [
    directory,
    historyBundle,
    pendingReviewSummaries,
    currentVocabWrongSummaries,
    pointBalances,
  ] = await Promise.all([
    directoryPromise,
    listAssignmentHistoryBundle({ reuseMaterialRequestCache: true }),
    listStudentPendingReviewSummaries(),
    listStudentCurrentVocabWrongSummaries(),
    pointBalancesPromise,
  ]);
  const assignmentUnits = directory.assignmentUnits;
  const history = historyBundle.history;

  return {
    appOrigin: getAppOrigin(),
    assignmentDatasets: directory.allDatasets,
    assignmentUnits,
    currentHistory: historyBundle.currentHistory,
    currentVocabWrongSummaries,
    datasets: directory.selectableDatasets,
    history,
    learningSources: directory.learningSources,
    pendingReviewSummaries,
    pointBalances,
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
