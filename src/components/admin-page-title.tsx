"use client";

import { usePathname } from "next/navigation";

const PAGE_TITLES = [
  { prefix: "/admin/results", title: "시험 결과" },
  { prefix: "/admin/assignments", title: "단어시험 배정" },
  { prefix: "/admin/students", title: "학생·접속코드" },
  { prefix: "/admin", title: "수업 현황" },
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
