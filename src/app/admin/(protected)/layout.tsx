import Link from "next/link";

import { AdminLogoutButton } from "@/components/admin-logout-button";
import { requireAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function AdminProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const admin = await requireAdmin();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="mini-brand" href="/admin">
            <span className="mini-brand-mark" aria-hidden="true">
              E
            </span>
            <span>영어 학습실 관리</span>
          </Link>
          <nav aria-label="관리 메뉴" className="nav-links">
            <Link className="nav-link" href="/admin">
              현황
            </Link>
            <Link className="nav-link" href="/admin/students">
              학생·코드
            </Link>
            <Link className="nav-link" href="/admin/assignments">
              시험 배정
            </Link>
            <Link className="nav-link" href="/admin/results">
              결과
            </Link>
          </nav>
          <div className="topbar-actions">
            <span className="user-label">{admin.displayName}</span>
            <AdminLogoutButton />
          </div>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
