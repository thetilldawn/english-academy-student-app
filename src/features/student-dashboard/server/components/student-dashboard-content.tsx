import type { StudentSession } from "@/lib/auth/student-session";

import { StudentDashboard } from "../../ui/student-dashboard";
import { getStudentDashboardInitial } from "../queries/student-dashboard-query";

export async function StudentDashboardContent({
  student,
}: {
  student: Pick<StudentSession, "studentId">;
}) {
  const snapshot = await getStudentDashboardInitial(student);

  return (
    <StudentDashboard
      snapshot={snapshot}
    />
  );
}
