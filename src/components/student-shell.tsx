"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { StudentLogoutButton } from "@/components/student-logout-button";
import { RouteScreenReaderTitle } from "@/components/route-screen-reader-title";
import { ThemeToggle } from "@/components/theme-toggle";
import { studentPageTitleForPathname } from "@/lib/ui/student-routes";

import styles from "./shell/app-shell.module.css";

export function StudentShell({
  children,
  displayName,
  gradeLabel,
}: {
  children: React.ReactNode;
  displayName: string;
  gradeLabel: string | null;
}) {
  const pathname = usePathname();
  const focusedAttempt = pathname.startsWith("/student/attempt/");
  const pageTitle = studentPageTitleForPathname(pathname);

  useEffect(() => {
    if (!window.location.hash) return;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }, []);

  return (
    <div
      className={[
        styles.appShell,
        styles.studentAppShell,
        focusedAttempt ? styles.studentAttemptShell : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {!focusedAttempt && (
        <header className={[styles.topbar, styles.studentTopbar].join(" ")}>
          <div className={styles.topbarInner}>
            {pageTitle ? <RouteScreenReaderTitle title={pageTitle} /> : null}
            <div className={styles.topbarActions}>
              <ThemeToggle />
              <span
                className={[styles.userLabel, styles.studentUserLabel].join(" ")}
              >
                {displayName}
                {gradeLabel ? ` · ${gradeLabel}` : ""}
              </span>
              <StudentLogoutButton />
            </div>
          </div>
        </header>
      )}
      {children}
    </div>
  );
}
