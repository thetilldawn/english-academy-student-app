"use client";

import { useSelectedLayoutSegment } from "next/navigation";

import { adminRouteForSegment } from "@/lib/ui/admin-routes";

import styles from "./shell/app-shell.module.css";

export function AdminPageTitle() {
  const segment = useSelectedLayoutSegment();
  const title = adminRouteForSegment(segment).pageTitle;

  return <strong className={styles.adminMobilePageTitle}>{title}</strong>;
}
