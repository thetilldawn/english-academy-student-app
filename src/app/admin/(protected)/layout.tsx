import Link from "next/link";

import { AdminNavigation } from "@/components/admin-navigation";
import { AdminLogoutButton } from "@/components/admin-logout-button";
import { AdminPageTitle } from "@/components/admin-page-title";
import { requireAdmin } from "@/lib/auth/admin";

export default async function AdminProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const admin = await requireAdmin();

  return (
    <div className="admin-app-shell">
      <aside className="admin-sidebar">
        <Link className="mini-brand admin-sidebar-brand" href="/admin">
          <span className="mini-brand-mark" aria-hidden="true">
            E
          </span>
          <span>영어 학습실 관리</span>
        </Link>
        <AdminNavigation
          className="admin-sidebar-nav"
          label="PC 관리 메뉴"
        />
        <div className="admin-sidebar-footer">
          <span className="user-label">{admin.displayName}</span>
          <AdminLogoutButton />
        </div>
      </aside>

      <div className="admin-workspace">
        <header className="admin-topbar">
          <div className="admin-topbar-inner">
            <Link className="mini-brand admin-tablet-brand" href="/admin">
              <span className="mini-brand-mark" aria-hidden="true">
                E
              </span>
              <span>영어 학습실 관리</span>
            </Link>
            <AdminPageTitle />
            <AdminNavigation
              className="admin-tablet-nav"
              label="태블릿 관리 메뉴"
            />
            <div className="topbar-actions">
              <span className="user-label admin-topbar-user">
                {admin.displayName}
              </span>
              <span className="user-label admin-mobile-user-label">
                관리자
              </span>
              <AdminLogoutButton />
            </div>
          </div>
        </header>

        <main className="content admin-content" id="main-content">
          {children}
        </main>
        <AdminNavigation
          className="admin-mobile-nav"
          label="모바일 관리 메뉴"
        />
      </div>
    </div>
  );
}
