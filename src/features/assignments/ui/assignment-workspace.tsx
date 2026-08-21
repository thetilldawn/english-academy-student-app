"use client";

import { toast } from "sonner";

import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import type { AssignmentManagerData } from "@/lib/services/assignment-manager-data";

import {
  useAssignmentWorkspace,
  type AssignmentDialogView,
} from "../controller/use-assignment-workspace";
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

  return (
    <>
      <AssignmentStudentBrowser controller={controller} />

      {controller.plannerOpen && controller.plannerStudents.length > 0 ? (
        <VocabAssignmentPlanner
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
          onSuccess={(assignmentCount, studentCount) => {
            if (controller.assignmentMode === "bulk") {
              controller.actions.clearBulkStudents();
            }
            toast.success(
              formatContentText(adminLearningText.page.bulk.success, {
                assignmentCount,
                studentCount,
              }),
            );
            controller.actions.refresh();
          }}
          students={controller.plannerStudents}
        />
      ) : null}
    </>
  );
}
