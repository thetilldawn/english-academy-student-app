import type { StudentSession } from "@/lib/auth/student-session";

import { StudentDashboard } from "../../ui/student-dashboard";
import { getStudentDashboardInitial } from "../queries/student-dashboard-query";
import { StudentSchoolScheduleContent } from "@/features/school-schedules/public-server";
import { Suspense } from "react";

export async function StudentDashboardContent({
  student,
}: {
  student: Pick<StudentSession, "studentId">;
}) {
  const snapshot = await getStudentDashboardInitial(student);

  return (
    <StudentDashboard
      schoolSchedule={<Suspense fallback={<p role="status">학교 일정을 불러오고 있습니다.</p>}><StudentSchoolScheduleContent /></Suspense>}
      snapshot={snapshot}
    />
  );
}
