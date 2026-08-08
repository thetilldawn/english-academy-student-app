"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";

import { adminShellText } from "@/content/ko/admin-shell";

const adminNavigationItems = [
  { href: "/admin", label: adminShellText.navigation.overview },
  { href: "/admin/students", label: adminShellText.navigation.students },
  { href: "/admin/assignments", label: adminShellText.navigation.learning },
  { href: "/admin/results", label: adminShellText.navigation.history },
] as const;

function isActivePath(pathname: string, href: string) {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavigationPendingIndicator() {
  const { pending } = useLinkStatus();

  return pending ? (
    <span
      aria-hidden="true"
      className="admin-nav-pending button-spinner"
    />
  ) : null;
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
            <span>{item.label}</span>
            <NavigationPendingIndicator />
          </Link>
        );
      })}
    </nav>
  );
}
