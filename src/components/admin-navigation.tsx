"use client";

import Link, { useLinkStatus } from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

import { adminShellText } from "@/content/ko/admin-shell";
import { ButtonSpinner } from "@/design-system/primitives/button/button";

const adminNavigationItems = [
  { href: "/admin", label: adminShellText.navigation.overview },
  { href: "/admin/students", label: adminShellText.navigation.students },
  { href: "/admin/assignments", label: adminShellText.navigation.learning },
  { href: "/admin/results", label: adminShellText.navigation.history },
] as const;

function isActiveSegment(segment: string | null, href: string) {
  if (href === "/admin") return segment === null;
  return segment === href.slice("/admin/".length);
}

function NavigationPendingIndicator() {
  const { pending } = useLinkStatus();

  return pending ? (
    <span className="admin-nav-pending">
      <ButtonSpinner />
    </span>
  ) : null;
}

export function AdminNavigation({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  const segment = useSelectedLayoutSegment();

  return (
    <nav aria-label={label} className={className}>
      {adminNavigationItems.map((item) => {
        const active = isActiveSegment(segment, item.href);

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
