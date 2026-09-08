"use client";

import Link from "next/link";

import { useRouter } from "next/navigation";

import { GuardedLink } from "@/components/guarded-link";
import { useRouteExitGuard } from "@/components/use-route-exit-guard";
import { adminStudentsText } from "@/content/ko/admin-students";
import { buttonRecipe } from "@/design-system/primitives/button/button";
import { Notice } from "@/design-system/patterns/feedback/feedback";

import type { StudentDetailInitial } from "../contracts/student-detail-read-model";
import { useStudentDetailShellState } from "../controller/use-student-detail-shell-state";
import { StudentDetailContent } from "./student-detail-content";
import { StudentDetailHeader } from "./student-detail-header";
import styles from "./student-detail.module.css";

export function StudentDetailPage({
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
    <article className={styles.page}>
      <header className={styles.pageHeader}>
        {interactionState.locked ? <h1 id="student-detail-page-title">로그인 확인</h1> : <StudentDetailHeader
          headingLevel={1}
          student={student}
          titleId="student-detail-page-title"
        />}
        <GuardedLink
          aria-disabled={interactionState.busy}
          className={buttonRecipe({ variant: "quiet" })}
          href="/admin/students"
          onClick={(event) => {
            if (interactionState.busy) event.preventDefault();
          }}
          tabIndex={interactionState.busy ? -1 : undefined}
        >
          {adminStudentsText.detail.backToList}
        </GuardedLink>
      </header>
      {interactionState.locked ? <Notice role="alert" tone="danger">관리자 로그인이 필요합니다. <Link href="/admin/login">관리자 로그인</Link></Notice> : <StudentDetailContent
        appOrigin={appOrigin}
        initial={{ ...initial, student }}
        initialTab={initialTab}
        onInteractionStateChange={actions.setInteractionState}
        onStudentRemoved={() => routeGuard.forceExit(() =>
          router.replace("/admin/students")
        )}
        onStudentUpdated={actions.mergeStudent}
        presentation="page"
      />}
    </article>
  );
}
