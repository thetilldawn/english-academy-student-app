"use client";

import { toast } from "sonner";

import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import type { AssignmentManagerData } from "@/lib/services/assignment-manager-data";

import {
  useAssignmentWorkspace,
  type AssignmentDialogView,
} from "../controller/use-assignment-workspace";
import { buildBulkStudentFilterLabels } from "../presentation/bulk-student-selection-summary";
import { AssignmentStudentBrowser } from "./assignment-student-browser";
import { VocabAssignmentPlanner } from "./vocab-assignment-planner";

export function AssignmentWorkspace({
  data,
  initialDatasetId = "",
  initialDialogView = "overview",
  initialStudentId = "",
}: {
  data: AssignmentManagerData;
  initialDatasetId?: string;
  initialDialogView?: AssignmentDialogView;
  initialStudentId?: string;
}) {
  const controller = useAssignmentWorkspace({
    data,
    initialDatasetId,
    initialDialogView,
    initialStudentId,
  });
  const activeFilteredStudentIds = new Set(
    controller.filteredStudents
      .filter((student) => student.status === "active")
      .map((student) => student.id),
  );
  const isWholeFilteredSelection =
    activeFilteredStudentIds.size === controller.plannerStudents.length &&
    controller.plannerStudents.every((student) =>
      activeFilteredStudentIds.has(student.id)
    );
  const bulkFilterLabels = buildBulkStudentFilterLabels({
    classGroupLabel: controller.classGroupOptions.find(
      (option) => option.value === controller.filters.classGroup,
    )?.label ?? null,
    filters: controller.filters,
    isWholeFilteredSelection,
  });

  return (
    <>
      <AssignmentStudentBrowser controller={controller} />

      {controller.plannerOpen && controller.plannerStudents.length > 0 ? (
        <VocabAssignmentPlanner
          bulkFilterLabels={bulkFilterLabels}
          data={controller.data}
          initialDatasetId={
            controller.assignmentMode === "bulk" &&
              controller.entryMode === "dataset"
              ? controller.entryDatasetId
              : controller.assignmentMode === "single"
                ? initialDatasetId
                : ""
          }
          onClose={controller.actions.closePlanner}
          onSuccess={(assignmentCount, studentCount, queuedCount) => {
            if (controller.assignmentMode === "bulk") {
              controller.actions.clearBulkStudents();
            }
            toast.success(
              formatContentText(
                queuedCount > 0
                  ? adminLearningText.page.bulk.queueSuccess
                  : adminLearningText.page.bulk.success,
                {
                  assignmentCount,
                  queuedCount,
                  studentCount,
                },
              ),
            );
            controller.actions.refresh();
          }}
          selectionMode={controller.assignmentMode}
          students={controller.plannerStudents}
        />
      ) : null}
    </>
  );
}
