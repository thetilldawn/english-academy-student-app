"use client";

import Link from "next/link";

import { useRouter } from "next/navigation";

import { RoutedDetailDialog } from "@/components/routed-detail-dialog";
import { useRouteExitGuard } from "@/components/use-route-exit-guard";
import { commonText } from "@/content/ko/common";
import { adminStudentsText } from "@/content/ko/admin-students";
import { DialogBody } from "@/design-system/primitives/dialog/dialog";
import { Notice } from "@/design-system/patterns/feedback/feedback";

import type { StudentDetailInitial } from "../contracts/student-detail-read-model";
import { useStudentDetailShellState } from "../controller/use-student-detail-shell-state";
import { StudentDetailContent } from "./student-detail-content";
import { StudentDetailHeader } from "./student-detail-header";

export function StudentDetailDialog({
  appOrigin,
  initial,
  initialTab,
}: {
  appOrigin: string;
  initial: StudentDetailInitial;
  initialTab?: "info" | "history";
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
        interactionState.locked ? <h2 id="student-detail-title">로그인 확인</h2> :
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
      {interactionState.locked ? <DialogBody><Notice role="alert" tone="danger">관리자 로그인이 필요합니다. <Link href="/admin/login">관리자 로그인</Link></Notice></DialogBody> : <StudentDetailContent
        appOrigin={appOrigin}
        initial={{ ...initial, student }}
        initialTab={initialTab}
        onInteractionStateChange={actions.setInteractionState}
        onStudentRemoved={() => routeGuard.forceExit(() => router.back())}
        onStudentUpdated={actions.mergeStudent}
        presentation="dialog"
      />}
    </RoutedDetailDialog>
  );
}
