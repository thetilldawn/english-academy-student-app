import type { StudentSession } from "@/lib/auth/student-session";
import { getStudentPointBalance } from "@/lib/services/learning-point-read-service";

import { StudentDashboard } from "../../ui/student-dashboard";
import { getStudentDashboardInitial } from "../queries/student-dashboard-query";

export async function StudentDashboardContent({
  student,
}: {
  student: Pick<StudentSession, "studentId">;
}) {
  const [snapshot, currentPoints] = await Promise.all([
    getStudentDashboardInitial(student),
    getStudentPointBalance(student.studentId),
  ]);

  return (
    <StudentDashboard
      currentPoints={currentPoints}
      snapshot={snapshot}
    />
  );
}

