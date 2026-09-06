"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";

import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { announceStudentDirectoryRefresh } from "@/features/students/public-client";

import type { AssignmentWorkspaceInitial } from "../contracts/assignment-workspace-read-model";
import {
  useAssignmentWorkspace,
  type AssignmentDialogView,
} from "../controller/use-assignment-workspace";
import { AssignmentPlannerLoadDialog } from "./assignment-planner-load-dialog";
import { AssignmentStudentBrowser } from "./assignment-student-browser";

const VocabAssignmentPlanner = dynamic(
  () => import("./vocab-assignment-planner").then(
    (module) => module.VocabAssignmentPlanner,
  ),
  {
    loading: () => (
      <AssignmentPlannerLoadDialog closeDisabled onClose={() => undefined} />
    ),
    ssr: false,
  },
);

export function AssignmentWorkspace({
  initial,
  initialDatasetId = "",
  initialDialogView = "overview",
  initialStudentId = "",
  cacheEnabled = false,
  interactionAllowed = true,
}: {
  initial: AssignmentWorkspaceInitial;
  initialDatasetId?: string;
  initialDialogView?: AssignmentDialogView;
  initialStudentId?: string;
  cacheEnabled?: boolean;
  interactionAllowed?: boolean;
}) {
  const controller = useAssignmentWorkspace({
    initial,
    initialDatasetId,
    initialDialogView,
    initialStudentId,
    cacheEnabled,
    interactionAllowed,
  });
  const planner = controller.planner;

  useEffect(() => {
    if (planner.status === "loading") {
      void import("./vocab-assignment-planner");
    }
  }, [planner.status]);

  return (
    <>
      <AssignmentStudentBrowser controller={controller} />

      {planner.status === "loading" ? (
        <AssignmentPlannerLoadDialog onClose={planner.actions.close} />
      ) : planner.status === "error" ? (
        <AssignmentPlannerLoadDialog
          error={planner.error}
          onClose={planner.actions.close}
          onRetry={() => void planner.actions.retry()}
        />
      ) : planner.status === "ready" && planner.request ? (
        <VocabAssignmentPlanner
          bulkFilterLabels={planner.request.bulkFilterLabels}
          data={{
            datasets: planner.data.datasets,
            timeTemplates: planner.data.timeTemplates,
            units: planner.data.initialUnits,
          }}
          initialDatasetId={planner.data.initialDatasetId}
          interactionAllowed={interactionAllowed}
          onClose={planner.actions.close}
          onSuccess={(assignmentCount, studentCount, queuedCount) => {
            announceStudentDirectoryRefresh();
            if (planner.request?.selectionMode === "bulk") {
              controller.actions.clearBulkStudents();
            }
            toast.success(
              formatContentText(
                queuedCount > 0
                  ? adminLearningText.page.bulk.queueSuccess
                  : adminLearningText.page.bulk.success,
                { assignmentCount, queuedCount, studentCount },
              ),
            );
            if (!cacheEnabled) controller.actions.refreshDirectory();
          }}
          selectionMode={planner.request.selectionMode}
          students={planner.data.students}
        />
      ) : null}
    </>
  );
}
