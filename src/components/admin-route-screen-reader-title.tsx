"use client";

import { usePathname } from "next/navigation";

import { adminPageTitleForPathname } from "@/lib/ui/admin-routes";

import { RouteScreenReaderTitle } from "./route-screen-reader-title";

export function AdminRouteScreenReaderTitle() {
  const pathname = usePathname();
  return <RouteScreenReaderTitle title={adminPageTitleForPathname(pathname)} />;
}
