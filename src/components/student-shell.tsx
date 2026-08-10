"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { StudentLogoutButton } from "@/components/student-logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { studentAppText } from "@/content/ko/student-app";

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
            <Link className={styles.brand} href="/student">
              <span className={styles.brandMark} aria-hidden="true">
                E
              </span>
              <span>{studentAppText.shell.brand}</span>
            </Link>
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
