"use client";

import { usePathname } from "next/navigation";

const PAGE_TITLES = [
  { prefix: "/admin/results", title: "내역" },
  { prefix: "/admin/assignments", title: "학습 관리" },
  { prefix: "/admin/students", title: "학생 관리" },
  { prefix: "/admin", title: "Overview" },
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
