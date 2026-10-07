"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DialogVisibilityBoundary } from "@/design-system/primitives/dialog/dialog";
import dynamic from "next/dynamic";
import { toast } from "sonner";

import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { announceStudentDirectoryRefresh } from "@/features/students/public-client";
import { emptyStudentDirectoryFilters, type StudentDirectorySnapshot } from "@/features/students/public-contracts";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";

import type { AssignmentWorkspaceInitial } from "../contracts/assignment-workspace-read-model";
import {
  useAssignmentWorkspace,
  type AssignmentDialogView,
} from "../controller/use-assignment-workspace";
import { AssignmentPlannerLoadDialog } from "./assignment-planner-load-dialog";
import { AssignmentStudentBrowser } from "./assignment-student-browser";
import { AssignmentPreparationChangedContext } from "../controller/use-assignment-planner-preparation";

const NotebookAssignmentDialog = dynamic(() => import("./notebook-assignment-dialog").then(module => module.NotebookAssignmentDialog), { ssr: false });

export const pendingAssignmentDirectory: StudentDirectorySnapshot = {
  filters: { ...emptyStudentDirectoryFilters, status: "active" }, filterOptions: { classGroups: [], grades: [], schools: [], wordbooks: [] },
  page: { items: [], nextCursor: null }, snapshotAt: "pending", totalCount: 0,
};

export function AssignmentWorkspacePending() {
  return <AssignmentWorkspace initial={{ directory: pendingAssignmentDirectory }} interactionAllowed={false}
    pendingContent={<RouteLoadingState label={adminLearningText.page.loading} />} />;
}

export function AssignmentWorkspace({
  initial,
  initialDatasetId = "",
  initialDialogView = "overview",
  initialStudentId = "",
  cacheEnabled = false,
  interactionAllowed = true,
  authenticationRecovery,
  pendingContent,
}: {
  initial: AssignmentWorkspaceInitial;
  initialDatasetId?: string;
  initialDialogView?: AssignmentDialogView;
  initialStudentId?: string;
  cacheEnabled?: boolean;
  interactionAllowed?: boolean;
  authenticationRecovery?: { error: string; retry: () => void };
  pendingContent?: ReactNode;
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
  const [Planner, setPlanner] = useState<typeof import("./vocab-assignment-planner").VocabAssignmentPlanner | null>(null);
  const [moduleError, setModuleError] = useState("");
  const [moduleRetry, setModuleRetry] = useState(0);
  const [notebook, setNotebook] = useState<{ students: { id: string; displayName: string }[]; audienceMode: "single" | "bulk" } | null>(null);

  useEffect(() => {
    if (Planner || (planner.status !== "loading" && planner.status !== "ready")) return;
    let active = true;
    void import("./vocab-assignment-planner").then(module => {
      if (active) setPlanner(() => module.VocabAssignmentPlanner);
    }).catch(() => { if (active) setModuleError("배정 화면을 불러오지 못했습니다. 다시 시도해 주세요."); });
    return () => { active = false; };
  }, [Planner, planner.status, moduleRetry]);

  return (
    <>
      <AssignmentStudentBrowser controller={controller} privateDataVisible={interactionAllowed} pendingContent={pendingContent} onNotebook={(students, audienceMode) => { if (interactionAllowed) setNotebook({ students, audienceMode }); }} />
      <DialogVisibilityBoundary visible={interactionAllowed}>
      {notebook ? <NotebookAssignmentDialog {...notebook} interactionAllowed={interactionAllowed} onClose={() => setNotebook(null)} onSuccess={count => {
        announceStudentDirectoryRefresh();
        if (notebook.audienceMode === "bulk") controller.actions.clearBulkStudents();
        setNotebook(null); toast.success(`${count.studentCount}명에게 개인 오답 시험 ${count.assignmentCount}개를 배정했습니다.`);
        if (!cacheEnabled) controller.actions.refreshDirectory();
      }} /> : null}

      {planner.status === "loading" || (planner.status === "ready" && !Planner) ? (
        <AssignmentPlannerLoadDialog onClose={planner.actions.close} error={moduleError}
          onRetry={() => { setModuleError(""); setModuleRetry(value => value + 1); }} />
      ) : planner.status === "error" ? (
        <AssignmentPlannerLoadDialog
          error={planner.error}
          onClose={planner.actions.close}
          onRetry={() => void planner.actions.retry()}
        />
      ) : planner.status === "ready" && planner.request && Planner ? (
        <AssignmentPreparationChangedContext.Provider value={planner.actions.invalidate}><Planner
          bulkFilterLabels={planner.request.bulkFilterLabels}
          data={{
            datasets: planner.data.datasets,
            timeTemplates: planner.data.timeTemplates,
            units: planner.data.initialUnits,
          }}
          initialDatasetId={planner.data.initialDatasetId}
          interactionAllowed={interactionAllowed}
          refreshDatasetMetadata={controller.actions.refreshDatasetMetadata}
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
        /></AssignmentPreparationChangedContext.Provider>
      ) : null}
      </DialogVisibilityBoundary>
      {!interactionAllowed && authenticationRecovery && (notebook || planner.status !== "idle") ? (
        <AssignmentPlannerLoadDialog closeDisabled onClose={() => undefined}
          error={authenticationRecovery.error}
          loadingLabel="접속 상태를 확인하고 있습니다. 작성 내용은 보관되어 있습니다."
          retryLabel="접속 다시 확인" onRetry={authenticationRecovery.retry} />
      ) : null}
    </>
  );
}
