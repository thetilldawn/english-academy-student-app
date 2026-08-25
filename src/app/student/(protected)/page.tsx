import type { Metadata } from "next";

import { studentAppText } from "@/content/ko/student-app";
import { StudentDashboard } from "@/features/student-dashboard/ui/student-dashboard";
import { requireStudentSession } from "@/lib/auth/student-session";
import { getStudentPointBalance } from "@/lib/services/learning-point-read-service";
import { listStudentAssignments } from "@/lib/services/quiz/student-assignment-query";

export const metadata: Metadata = {
  title: studentAppText.dashboard.metadataTitle,
};

export default async function StudentDashboardPage() {
  const session = await requireStudentSession();
  const [assignments, currentPoints] = await Promise.all([
    listStudentAssignments(session.studentId),
    getStudentPointBalance(session.studentId),
  ]);

  return (
    <StudentDashboard
      assignments={assignments}
      currentPoints={currentPoints}
      displayName={session.displayName}
    />
  );
}
