"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { StudentLogoutButton } from "@/components/student-logout-button";
import { RouteScreenReaderTitle } from "@/components/route-screen-reader-title";
import { ThemeToggle } from "@/components/theme-toggle";
import { studentPageTitleForPathname } from "@/lib/ui/student-routes";
import { useStudentHistoryRefresh } from "./use-student-history-refresh";

import styles from "./shell/app-shell.module.css";

export function StudentShell({
  children,
  displayName,
  gradeLabel,
  points,
}: {
  children: React.ReactNode;
  displayName: string;
  gradeLabel: string | null;
  points: React.ReactNode;
}) {
  const pathname = usePathname();
  const focusedAttempt = pathname.startsWith("/student/attempt/");
  const pageTitle = studentPageTitleForPathname(pathname);
  const shellRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  useStudentHistoryRefresh(pathname);

  useEffect(() => {
    const header = headerRef.current;
    const shell = shellRef.current;
    if (!header || !shell) return;
    const updateOffset = () => {
      const height = Math.ceil(header.getBoundingClientRect().height);
      if (height > 0) {
        shell.style.setProperty("--student-topbar-offset", `${height}px`);
      }
    };
    updateOffset();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateOffset);
    observer?.observe(header);
    return () => observer?.disconnect();
  }, [focusedAttempt]);

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
      ref={shellRef}
      className={[
        styles.appShell,
        styles.studentAppShell,
        focusedAttempt ? styles.studentAttemptShell : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {!focusedAttempt && (
        <header className={[styles.topbar, styles.studentTopbar].join(" ")} ref={headerRef}>
          <div className={[styles.topbarInner, styles.studentTopbarInner].join(" ")}>
            {pageTitle ? <RouteScreenReaderTitle title={pageTitle} /> : null}
            <div className={styles.studentIdentity}>
              <span className={styles.studentUserLabel}>
                {displayName}
                {gradeLabel ? ` · ${gradeLabel}` : ""}
              </span>
              <span aria-hidden="true" className={styles.studentIdentityDivider}>|</span>
              {points}
            </div>
            <div className={[styles.topbarActions, styles.studentControls].join(" ")}>
              <ThemeToggle />
              <StudentLogoutButton />
            </div>
          </div>
        </header>
      )}
      {children}
    </div>
  );
}
