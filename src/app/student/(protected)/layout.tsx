import Link from "next/link";

import { StudentLogoutButton } from "@/components/student-logout-button";
import { requireStudentSession } from "@/lib/auth/student-session";

export const dynamic = "force-dynamic";

export default async function StudentProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const student = await requireStudentSession();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="mini-brand" href="/student">
            <span className="mini-brand-mark" aria-hidden="true">
              E
            </span>
            <span>영어 학습실</span>
          </Link>
          <div className="topbar-actions">
            <span className="user-label">
              {student.displayName}
              {student.gradeLabel ? ` · ${student.gradeLabel}` : ""}
            </span>
            <StudentLogoutButton />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
