import { StudentShell } from "@/components/student-shell";
import { requireStudentSession } from "@/lib/auth/student-session";

export const dynamic = "force-dynamic";

export default async function StudentProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const student = await requireStudentSession();

  return (
    <StudentShell
      displayName={student.displayName}
      gradeLabel={student.gradeLabel}
    >
      {children}
    </StudentShell>
  );
}
