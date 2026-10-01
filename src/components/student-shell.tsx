"use client";

import { usePathname } from "next/navigation";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";
import { studentAppText } from "@/content/ko/student-app";
import { HeaderPointSummary } from "@/features/learning-points/public-ui";
import { useEffect, useRef } from "react";

import { StudentLogoutButton } from "@/components/student-logout-button";
import { RouteScreenReaderTitle } from "@/components/route-screen-reader-title";
import { ThemeToggle } from "@/components/theme-toggle";
import { studentPageTitleForPathname } from "@/lib/ui/student-routes";
import { useStudentHistoryRefresh } from "./use-student-history-refresh";

import styles from "./shell/app-shell.module.css";

type StudentShellProps = {
  children: React.ReactNode;
  displayName: string;
  gradeLabel: string | null;
  schoolName?: string | null;
  points: React.ReactNode;
  identity?: React.ReactNode;
};

export function StudentShell(props: StudentShellProps) {
  useStudentHistoryRefresh(usePathname());
  return <StudentShellFrame {...props} />;
}

export function StudentShellPending() {
  const pathname = usePathname();
  const focused = pathname.startsWith("/student/attempt/") || /^\/student\/practice\/[^/]+\/?$/u.test(pathname);
  return <StudentShellFrame displayName="　" gradeLabel={null} points={<HeaderPointSummary state="loading" />} pending>
    <RouteLoadingState label={focused ? "시험 준비 중" : "화면을 불러오는 중입니다."} />
  </StudentShellFrame>;
}

function StudentShellFrame({
  children,
  displayName,
  gradeLabel,
  schoolName,
  points,
  identity,
  pending = false,
}: StudentShellProps & { pending?: boolean }) {
  const pathname = usePathname();
  const focusedAttempt = pathname.startsWith("/student/attempt/") || /^\/student\/practice\/[^/]+\/?$/u.test(pathname);
  const pageTitle = studentPageTitleForPathname(pathname);
  const shellRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

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
    if (pending || !window.location.hash) return;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }, [pending]);

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
              {identity ?? <span className={styles.studentUserLabel}>
                {displayName}
                {schoolName ? ` · ${schoolName}` : ""}
                {gradeLabel ? ` · ${gradeLabel}` : ""}
              </span>}
              <span aria-hidden="true" className={styles.studentIdentityDivider}>|</span>
              {points}
            </div>
            <div className={[styles.topbarActions, styles.studentControls].join(" ")}>
              {pending ? <Button disabled size="small" variant="quiet">내 단어장</Button> : <ButtonLink href="/student/wordbook" prefetch={false} size="small" variant="quiet">내 단어장</ButtonLink>}
              <ThemeToggle />
              {pending ? <Button disabled size="small" variant="quiet">{studentAppText.shell.logout}</Button> : <StudentLogoutButton />}
            </div>
          </div>
        </header>
      )}
      {children}
    </div>
  );
}
