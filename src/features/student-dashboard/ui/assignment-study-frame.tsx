import type { ReactNode } from "react";
import { RoutedDetailDialog } from "@/components/routed-detail-dialog";
import { studentAppText } from "@/content/ko/student-app";
import { ButtonLink, ButtonSpinner } from "@/design-system/primitives/button/button";
import type { StudyPresentation } from "../contracts/assignment-study";
import styles from "./assignment-study.module.css";

export function AssignmentStudyFrame({ children, presentation, title = studentAppText.study.title }: {
  children: ReactNode;
  presentation: StudyPresentation;
  title?: string;
}) {
  const heading = <h2 className={styles.title} id="assignment-study-title">{title}</h2>;
  if (presentation === "dialog") return (
    <RoutedDetailDialog closeLabel={studentAppText.study.close} fullScreenMobile heading={heading}
      height="large" size="wide" titleId="assignment-study-title">
      {children}
    </RoutedDetailDialog>
  );
  return (
    <main className={styles.page} id="main-content" aria-labelledby="assignment-study-title">
      <header className={styles.header}>
        {heading}
        <ButtonLink href="/student" prefetch={false} variant="secondary">{studentAppText.study.close}</ButtonLink>
      </header>
      <div className={styles.body}>{children}</div>
    </main>
  );
}

export function AssignmentStudyLoading({ presentation }: { presentation: StudyPresentation }) {
  return <AssignmentStudyFrame presentation={presentation}>
    <p className={styles.loading} role="status"><ButtonSpinner />{studentAppText.study.loading}</p>
  </AssignmentStudyFrame>;
}

export function AssignmentStudyNotFound({ presentation }: { presentation: StudyPresentation }) {
  return <AssignmentStudyFrame presentation={presentation}>
    <p>{studentAppText.study.notFound}</p>
  </AssignmentStudyFrame>;
}
