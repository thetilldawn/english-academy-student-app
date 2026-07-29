"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const adminNavigationItems = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/students", label: "학생 관리" },
  { href: "/admin/assignments", label: "시험 관리" },
  { href: "/admin/results", label: "내역" },
] as const;

function isActivePath(pathname: string, href: string) {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNavigation({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className={className}>
      {adminNavigationItems.map((item) => {
        const active = isActivePath(pathname, item.href);

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className="admin-nav-link"
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
