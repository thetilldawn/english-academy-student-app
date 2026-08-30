import { Suspense } from "react";

import { StudentShell } from "@/components/student-shell";
import { NotificationBootstrap } from "@/components/notification-bootstrap";
import { studentAppText } from "@/content/ko/student-app";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";
import { StudentSessionRenewal } from "@/features/session/ui/student-session-renewal";
import {
  getStudentSession,
  studentSessionRenewalDelay,
} from "@/lib/auth/student-session";
import { redirect } from "next/navigation";

export default function StudentProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <Suspense
      fallback={(
        <RouteLoadingState
          label={studentAppText.login.loading}
          variant="shell"
        />
      )}
    >
      <StudentProtectedShell>{children}</StudentProtectedShell>
    </Suspense>
  );
}

async function StudentProtectedShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const student = await getStudentSession();
  if (!student) {
    redirect("/");
  }

  return (
    <>
      <StudentSessionRenewal
        initialDelayMilliseconds={studentSessionRenewalDelay(
          student.lastSeenAt,
        )}
      />
      <NotificationBootstrap role="student" />
      <StudentShell
        displayName={student.displayName}
        gradeLabel={student.gradeLabel}
      >
        {children}
      </StudentShell>
    </>
  );
}
