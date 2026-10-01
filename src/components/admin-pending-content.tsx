"use client";

import { usePathname } from "next/navigation";
import { adminShellText } from "@/content/ko/admin-shell";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";
import { AssignmentWorkspacePending } from "@/features/assignments/ui/assignment-workspace";
import { AdminHistoryListPending } from "@/features/history/ui/admin-history-list";
import { StudentCreatePending } from "@/features/students/ui/student-create-workspace";
import { StudentDirectorySkeleton } from "@/features/students/ui/student-directory-skeleton";

/** Static, disabled frames only. Authentication and data loading remain in the server content. */
export function AdminPendingContent() {
  const pathname = usePathname();
  if (pathname === "/admin/students") return <><StudentCreatePending /><StudentDirectorySkeleton /></>;
  if (pathname === "/admin/assignments") return <AssignmentWorkspacePending />;
  if (pathname === "/admin/results") return <AdminHistoryListPending />;
  return <RouteLoadingState label={adminShellText.loading} />;
}
