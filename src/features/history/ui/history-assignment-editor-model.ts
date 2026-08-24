import { newAssignmentDefaultUnitIds } from "@/lib/admin/new-assignment-range";
import {
  emptyPendingReviewCounts,
  indexStudentPendingReviewSummaries,
  pendingReviewSummaryKey,
} from "@/lib/admin/review-queue-summary";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import type { AssignmentManagerData } from "@/lib/admin/assignment-manager-data";

export function buildHistoryAssignmentEditorModel(
  editorData: AssignmentManagerData | null,
  item: AssignmentHistorySummary,
) {
  if (!editorData) return null;
  const student = editorData.students.find(
    (candidate) => candidate.id === item.studentId,
  );
  if (!student) return null;
  const readyDatasets = editorData.datasets.filter(
    (dataset) =>
      dataset.status === "ready" &&
      dataset.isActive &&
      dataset.isAssignable,
  );
  const initialDatasetId = readyDatasets.some(
    (dataset) => dataset.id === item.datasetId,
  )
    ? item.datasetId
    : readyDatasets.some(
          (dataset) => dataset.id === student.currentVocabDatasetId,
        )
      ? student.currentVocabDatasetId!
      : readyDatasets[0]?.id ?? "";
  const progress =
    editorData.progress.find(
      (candidate) => candidate.studentId === student.id,
    ) ?? null;
  const preferredUnitIds = item.primaryUnitIds.filter((unitId) =>
    editorData.units.some(
      (unit) => unit.id === unitId && unit.datasetId === initialDatasetId,
    ),
  );
  const pendingIndex = indexStudentPendingReviewSummaries(
    editorData.pendingReviewSummaries,
  );
  const reviewCounts = initialDatasetId
    ? (pendingIndex.byStudentDataset.get(
        pendingReviewSummaryKey(student.id, initialDatasetId),
      ) ?? emptyPendingReviewCounts())
    : emptyPendingReviewCounts();

  return {
    availableReviewLevel1:
      reviewCounts.pendingLevel1Count - reviewCounts.reservedLevel1Count,
    availableReviewLevel2:
      reviewCounts.pendingLevel2Count - reviewCounts.reservedLevel2Count,
    datasets: editorData.datasets,
    initialDatasetId,
    initialUnitIds:
      preferredUnitIds.length > 0
        ? preferredUnitIds
        : newAssignmentDefaultUnitIds(progress, initialDatasetId),
    progress,
    student,
    units: editorData.units,
  };
}
