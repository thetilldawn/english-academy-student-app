"use client";

import { useSelectedLayoutSegment } from "next/navigation";

import { GuardedLink } from "@/components/guarded-link";
import {
  ADMIN_ROUTES,
  type AdminNavigationVariant,
} from "@/lib/ui/admin-routes";

import styles from "./shell/admin-navigation.module.css";

export function AdminNavigation({
  label,
  variant,
  pending = false,
}: {
  label: string;
  variant: AdminNavigationVariant;
  pending?: boolean;
}) {
  const segment = useSelectedLayoutSegment();

  return (
    <nav
      aria-label={label}
      className={[styles.root, styles[variant]].join(" ")}
    >
      {ADMIN_ROUTES.map((item) => {
        const active = item.segment === segment;
        if (pending) return <span aria-current={active ? "page" : undefined} className={styles.link} key={item.href}>{item.navLabel}</span>;

        return (
          <GuardedLink
            aria-current={active ? "page" : undefined}
            className={styles.link}
            href={item.href}
            key={item.href}
          >
            <span>{item.navLabel}</span>
          </GuardedLink>
        );
      })}
    </nav>
  );
}
