"use client";

import Link, { useLinkStatus } from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

import { ButtonSpinner } from "@/design-system/primitives/button/button";
import {
  ADMIN_ROUTES,
  type AdminNavigationVariant,
} from "@/lib/ui/admin-routes";

import styles from "./shell/admin-navigation.module.css";

function NavigationPendingIndicator() {
  const { pending } = useLinkStatus();

  return (
    <span aria-hidden="true" className={styles.pending}>
      {pending ? <ButtonSpinner /> : null}
    </span>
  );
}

export function AdminNavigation({
  label,
  variant,
}: {
  label: string;
  variant: AdminNavigationVariant;
}) {
  const segment = useSelectedLayoutSegment();

  return (
    <nav
      aria-label={label}
      className={[styles.root, styles[variant]].join(" ")}
    >
      {ADMIN_ROUTES.map((item) => {
        const active = item.segment === segment;

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={styles.link}
            href={item.href}
            key={item.href}
          >
            <span>{item.navLabel}</span>
            <NavigationPendingIndicator />
          </Link>
        );
      })}
    </nav>
  );
}
