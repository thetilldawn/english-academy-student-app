import type { Metadata } from "next";

import { studentAppText } from "@/content/ko/student-app";
import { StudentDashboard } from "@/features/student-dashboard/ui/student-dashboard";
import { requireStudentSession } from "@/lib/auth/student-session";
import { listStudentAssignments } from "@/lib/services/quiz/student-assignment-query";

export const metadata: Metadata = {
  title: studentAppText.dashboard.metadataTitle,
};

export default async function StudentDashboardPage() {
  const session = await requireStudentSession();
  const assignments = await listStudentAssignments(session.studentId);

  return (
    <StudentDashboard
      assignments={assignments}
      displayName={session.displayName}
    />
  );
}
