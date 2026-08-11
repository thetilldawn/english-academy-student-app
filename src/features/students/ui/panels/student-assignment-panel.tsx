"use client";

import { useMemo } from "react";

import { SingleAssignmentEditor } from "@/features/assignments/ui/single-assignment-editor";
import { newAssignmentDefaultUnitId } from "@/lib/admin/new-assignment-range";
import {
  emptyPendingReviewCounts,
  indexStudentPendingReviewSummaries,
  pendingReviewSummaryKey,
} from "@/lib/admin/review-queue-summary";

import type { StudentDetailController } from "../../controller/use-student-detail-controller";
import type { StudentManagementData } from "../../model";

export function StudentAssignmentPanel({
  controller,
  data,
}: {
  controller: StudentDetailController;
  data: StudentManagementData;
}) {
  const route = controller.route;
  const student = controller.selectedStudent;
  const readyDatasets = useMemo(
    () =>
      data.assignmentDatasets.filter(
        (dataset) =>
          dataset.status === "ready" &&
          dataset.isActive &&
          dataset.isAssignable,
      ),
    [data.assignmentDatasets],
  );
  const pendingIndex = useMemo(
    () => indexStudentPendingReviewSummaries(data.pendingReviewSummaries),
    [data.pendingReviewSummaries],
  );

  if (route.kind !== "assignment" || !student) return null;

  const initialDatasetId = readyDatasets.some(
    (dataset) => dataset.id === route.datasetId,
  )
    ? route.datasetId
    : readyDatasets.some(
          (dataset) => dataset.id === student.currentVocabDatasetId,
        )
      ? student.currentVocabDatasetId!
      : readyDatasets[0]?.id ?? "";
  const progress =
    data.progress.find((item) => item.studentId === student.id) ?? null;
  const initialUnitId = newAssignmentDefaultUnitId(progress, initialDatasetId);
  const reviewCounts = initialDatasetId
    ? (pendingIndex.byStudentDataset.get(
        pendingReviewSummaryKey(student.id, initialDatasetId),
      ) ?? emptyPendingReviewCounts())
    : emptyPendingReviewCounts();

  return (
    <SingleAssignmentEditor
      availableReviewLevel1={
        reviewCounts.pendingLevel1Count - reviewCounts.reservedLevel1Count
      }
      availableReviewLevel2={
        reviewCounts.pendingLevel2Count - reviewCounts.reservedLevel2Count
      }
      datasets={data.assignmentDatasets}
      editTarget={null}
      embedded
      initialDatasetId={initialDatasetId}
      initialUnitId={initialUnitId}
      key={`${student.id}:${initialDatasetId}:create`}
      onBusyChange={controller.actions.setAssignmentBusy}
      onConflict={controller.actions.refreshData}
      onSucceeded={() => {
        controller.actions.refreshData();
        controller.actions.backOneLevel();
      }}
      progress={progress}
      student={student}
      units={data.assignmentUnits}
    />
  );
}
