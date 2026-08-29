"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { RoutedDetailDialog } from "@/components/routed-detail-dialog";
import { useRouteExitGuard } from "@/components/use-route-exit-guard";
import { commonText } from "@/content/ko/common";
import { adminStudentsText } from "@/content/ko/admin-students";

import type { StudentDetailInitial } from "../contracts/student-detail-read-model";
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
  const [interactionState, setInteractionState] = useState({
    busy: false,
    dirty: false,
  });
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
          student={initial.student}
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
        initial={initial}
        onInteractionStateChange={setInteractionState}
        onStudentRemoved={() => routeGuard.forceExit(() => router.back())}
        presentation="dialog"
      />
    </RoutedDetailDialog>
  );
}
