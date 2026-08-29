"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { GuardedLink } from "@/components/guarded-link";
import { useRouteExitGuard } from "@/components/use-route-exit-guard";
import { adminStudentsText } from "@/content/ko/admin-students";
import { buttonRecipe } from "@/design-system/primitives/button/button";

import type { StudentDetailInitial } from "../contracts/student-detail-read-model";
import { StudentDetailContent } from "./student-detail-content";
import { StudentDetailHeader } from "./student-detail-header";
import styles from "./student-detail.module.css";

export function StudentDetailPage({
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
    <article className={styles.page}>
      <header className={styles.pageHeader}>
        <StudentDetailHeader
          headingLevel={1}
          student={initial.student}
          titleId="student-detail-page-title"
        />
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
      <StudentDetailContent
        appOrigin={appOrigin}
        initial={initial}
        onInteractionStateChange={setInteractionState}
        onStudentRemoved={() => routeGuard.forceExit(() =>
          router.replace("/admin/students")
        )}
        presentation="page"
      />
    </article>
  );
}
