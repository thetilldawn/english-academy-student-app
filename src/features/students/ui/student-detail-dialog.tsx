"use client";

import { useRouter } from "next/navigation";

import { RoutedDetailDialog } from "@/components/routed-detail-dialog";
import { useRouteExitGuard } from "@/components/use-route-exit-guard";
import { commonText } from "@/content/ko/common";
import { adminStudentsText } from "@/content/ko/admin-students";

import type { StudentDetailInitial } from "../contracts/student-detail-read-model";
import { useStudentDetailShellState } from "../controller/use-student-detail-shell-state";
import { StudentDetailContent } from "./student-detail-content";
import { StudentDetailHeader } from "./student-detail-header";

export function StudentDetailDialog({
  appOrigin,
  initial,
}: {
  appOrigin: string;
  initial: StudentDetailInitial;
}) {
  const router = useRouter();
  const { actions, interactionState, student } = useStudentDetailShellState(
    initial.student,
  );
  const routeGuard = useRouteExitGuard({
    busy: interactionState.busy,
    confirmMessage: adminStudentsText.detail.discardChangesConfirm,
    dirty: interactionState.dirty,
    idPrefix: "student-detail",
  });

  return (
    <RoutedDetailDialog
      closeDisabled={interactionState.busy}
      closeLabel={commonText.modal.close}
      contentMode="structured"
      fullScreenMobile
      heading={
        <StudentDetailHeader
          student={student}
          titleId="student-detail-title"
        />
      }
      height="medium"
      layout="tabs"
      routeCloseGuard={routeGuard.requestExit}
      size="wide"
      titleId="student-detail-title"
    >
      <StudentDetailContent
        appOrigin={appOrigin}
        initial={{ ...initial, student }}
        onInteractionStateChange={actions.setInteractionState}
        onStudentRemoved={() => routeGuard.forceExit(() => router.back())}
        onStudentUpdated={actions.mergeStudent}
        presentation="dialog"
      />
    </RoutedDetailDialog>
  );
}
