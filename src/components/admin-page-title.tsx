"use client";

import { useSelectedLayoutSegment } from "next/navigation";

import { adminShellText } from "@/content/ko/admin-shell";

const PAGE_TITLES = {
  assignments: adminShellText.pageTitles.learning,
  results: adminShellText.pageTitles.history,
  students: adminShellText.pageTitles.students,
} as const;

export function AdminPageTitle() {
  const segment = useSelectedLayoutSegment();
  const title =
    segment && segment in PAGE_TITLES
      ? PAGE_TITLES[segment as keyof typeof PAGE_TITLES]
      : adminShellText.pageTitles.overview;

  return <strong className="admin-mobile-page-title">{title}</strong>;
}
