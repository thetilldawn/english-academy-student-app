"use client";

import { usePathname } from "next/navigation";

import { adminShellText } from "@/content/ko/admin-shell";

const PAGE_TITLES = [
  { prefix: "/admin/results", title: adminShellText.pageTitles.history },
  { prefix: "/admin/assignments", title: adminShellText.pageTitles.learning },
  { prefix: "/admin/students", title: adminShellText.pageTitles.students },
  { prefix: "/admin", title: adminShellText.pageTitles.overview },
] as const;

export function AdminPageTitle() {
  const pathname = usePathname();
  const current =
    PAGE_TITLES.find(({ prefix }) =>
      prefix === "/admin"
        ? pathname === prefix
        : pathname.startsWith(prefix),
    ) ?? PAGE_TITLES[PAGE_TITLES.length - 1];

  return <strong className="admin-mobile-page-title">{current.title}</strong>;
}
