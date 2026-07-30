import { StudentShell } from "@/components/student-shell";
import { getStudentSession } from "@/lib/auth/student-session";
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
    <StudentShell
      displayName={student.displayName}
      gradeLabel={student.gradeLabel}
    >
      {children}
    </StudentShell>
  );
}
