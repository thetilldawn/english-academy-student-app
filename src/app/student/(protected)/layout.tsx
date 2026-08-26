import { StudentShell } from "@/components/student-shell";
import { NotificationBootstrap } from "@/components/notification-bootstrap";
import { StudentSessionRenewal } from "@/features/session/ui/student-session-renewal";
import {
  getStudentSession,
  studentSessionRenewalDelay,
} from "@/lib/auth/student-session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function StudentProtectedLayout({
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
