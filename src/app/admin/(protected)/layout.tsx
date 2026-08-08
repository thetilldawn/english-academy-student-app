import Link from "next/link";

import { AdminNavigation } from "@/components/admin-navigation";
import { AdminLogoutButton } from "@/components/admin-logout-button";
import { AdminPageTitle } from "@/components/admin-page-title";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBootstrap } from "@/components/notification-bootstrap";
import { adminShellText } from "@/content/ko/admin-shell";
import { requireAdmin } from "@/lib/auth/admin";

export default async function AdminProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const admin = await requireAdmin();

  return (
    <div className="admin-app-shell">
      <NotificationBootstrap role="admin" />
      <aside className="admin-sidebar">
        <Link className="mini-brand admin-sidebar-brand" href="/admin">
          <span className="mini-brand-mark" aria-hidden="true">
            E
          </span>
          <span>{adminShellText.brand}</span>
        </Link>
        <AdminNavigation
          className="admin-sidebar-nav"
          label={adminShellText.navigation.pcAriaLabel}
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
              <span>{adminShellText.brand}</span>
            </Link>
            <AdminPageTitle />
            <AdminNavigation
              className="admin-tablet-nav"
              label={adminShellText.navigation.tabletAriaLabel}
            />
            <div className="topbar-actions">
              <ThemeToggle />
              <span className="user-label admin-topbar-user">
                {admin.displayName}
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
          label={adminShellText.navigation.mobileAriaLabel}
        />
      </div>
    </div>
  );
}
