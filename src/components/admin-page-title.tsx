"use client";

import { usePathname } from "next/navigation";

import { adminPageTitleForPathname } from "@/lib/ui/admin-routes";

import styles from "./shell/app-shell.module.css";

export function AdminPageTitle() {
  const pathname = usePathname();
  const title = adminPageTitleForPathname(pathname);

  return <strong className={styles.adminMobilePageTitle}>{title}</strong>;
}
