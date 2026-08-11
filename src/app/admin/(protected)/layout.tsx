import Link from "next/link";

import { AdminNavigation } from "@/components/admin-navigation";
import { AdminLogoutButton } from "@/components/admin-logout-button";
import { AdminPageTitle } from "@/components/admin-page-title";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBootstrap } from "@/components/notification-bootstrap";
import { adminShellText } from "@/content/ko/admin-shell";
import { requireAdmin } from "@/lib/auth/admin";

import shellStyles from "@/components/shell/app-shell.module.css";

export default async function AdminProtectedLayout({
  children,
  detail,
}: Readonly<{
  children: React.ReactNode;
  detail: React.ReactNode;
}>) {
  const admin = await requireAdmin();

  return (
    <div className={shellStyles.adminAppShell}>
      <NotificationBootstrap role="admin" />
      <aside className={shellStyles.adminSidebar}>
        <Link
          className={[shellStyles.brand, shellStyles.adminSidebarBrand].join(" ")}
          href="/admin"
        >
          <span className={shellStyles.brandMark} aria-hidden="true">
            E
          </span>
          <span>{adminShellText.brand}</span>
        </Link>
        <AdminNavigation
          label={adminShellText.navigation.pcAriaLabel}
          variant="sidebar"
        />
        <div className={shellStyles.adminSidebarFooter}>
          <span className={shellStyles.userLabel}>{admin.displayName}</span>
          <AdminLogoutButton />
        </div>
      </aside>

      <div className={shellStyles.adminWorkspace}>
        <header className={shellStyles.adminTopbar}>
          <div className={shellStyles.adminTopbarInner}>
            <Link
              className={[shellStyles.brand, shellStyles.adminTabletBrand].join(" ")}
              href="/admin"
            >
              <span className={shellStyles.brandMark} aria-hidden="true">
                E
              </span>
              <span>{adminShellText.brand}</span>
            </Link>
            <AdminPageTitle />
            <AdminNavigation
              label={adminShellText.navigation.tabletAriaLabel}
              variant="tablet"
            />
            <div className={shellStyles.topbarActions}>
              <ThemeToggle />
              <div className={shellStyles.adminTopbarSession}>
                <span
                  className={[shellStyles.userLabel, shellStyles.adminTopbarUser].join(" ")}
                >
                  {admin.displayName}
                </span>
                <AdminLogoutButton />
              </div>
            </div>
          </div>
        </header>

        <main
          className={shellStyles.adminContent}
          id="main-content"
        >
          {children}
        </main>
        <AdminNavigation
          label={adminShellText.navigation.mobileAriaLabel}
          variant="mobile"
        />
      </div>
      {detail}
    </div>
  );
}
