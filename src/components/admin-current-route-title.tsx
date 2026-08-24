"use client";

import { usePathname } from "next/navigation";

import { adminBreadcrumbForPathname } from "@/lib/ui/admin-routes";

import { AdminBreadcrumb } from "./admin-breadcrumb";

export function AdminCurrentRouteTitle() {
  const pathname = usePathname();
  const location = adminBreadcrumbForPathname(pathname);
  return <AdminBreadcrumb {...location} variant="topbar" />;
}
