import type { Metadata } from "next";
import { Suspense } from "react";

import { studentAppText } from "@/content/ko/student-app";
import { StudentDashboardContent } from "@/features/student-dashboard/server/components/student-dashboard-content";
import { StudentDashboardSkeleton } from "@/features/student-dashboard/ui/student-dashboard-skeleton";
import { requireStudentSession } from "@/lib/auth/student-session";

export const metadata: Metadata = {
  title: studentAppText.dashboard.metadataTitle,
};

export default async function StudentDashboardPage() {
  const session = await requireStudentSession();

  return (
    <Suspense fallback={<StudentDashboardSkeleton />}>
      <StudentDashboardContent student={session} />
    </Suspense>
  );
}
