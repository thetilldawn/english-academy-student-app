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
import { StudentSchoolIdentity } from "@/features/school-schedules/public-server";

export default function StudentProtectedLayout({
  children,
  detail,
  summary,
}: Readonly<{ children: React.ReactNode; detail: React.ReactNode; summary: React.ReactNode }>) {
  return (
    <Suspense
      fallback={(
        <RouteLoadingState
          label={studentAppText.login.loading}
          variant="shell"
        />
      )}
    >
      <StudentProtectedShell detail={detail} summary={summary}>{children}</StudentProtectedShell>
    </Suspense>
  );
}

async function StudentProtectedShell({
  children,
  detail,
  summary,
}: Readonly<{ children: React.ReactNode; detail: React.ReactNode; summary: React.ReactNode }>) {
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
        schoolName={student.schoolName}
        points={summary}
        identity={<Suspense fallback={<span>{student.displayName}</span>}><StudentSchoolIdentity>
          <span>{[student.displayName, student.schoolName, student.gradeLabel].filter(Boolean).join(" · ")}</span>
        </StudentSchoolIdentity></Suspense>}
      >
        {children}
      </StudentShell>
      {detail}
    </>
  );
}
