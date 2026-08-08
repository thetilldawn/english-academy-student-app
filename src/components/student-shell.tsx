"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { StudentLogoutButton } from "@/components/student-logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { studentAppText } from "@/content/ko/student-app";

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
        "app-shell",
        "student-app-shell",
        focusedAttempt ? "student-attempt-shell" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {!focusedAttempt && (
        <header className="topbar student-topbar">
          <div className="topbar-inner">
            <Link className="mini-brand" href="/student">
              <span className="mini-brand-mark" aria-hidden="true">
                E
              </span>
              <span>{studentAppText.shell.brand}</span>
            </Link>
            <div className="topbar-actions">
              <ThemeToggle />
              <span className="user-label student-user-label">
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
