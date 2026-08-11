import type { Metadata } from "next";

import { AdminBreadcrumb } from "@/components/admin-breadcrumb";
import {
  OverviewActionGroups,
  OverviewEmptyState,
} from "@/features/history/ui/overview-action-groups";
import { adminOverviewText } from "@/content/ko/admin-overview";
import { overviewActivityGroups } from "@/features/history/domain/learning-activity";
import { listAssignmentHistoryBundle } from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: adminOverviewText.page.title,
};

export default async function AdminDashboardPage() {
  const historyBundle = await listAssignmentHistoryBundle();
  const currentHistory = historyBundle.currentHistory;
  const groups = overviewActivityGroups(currentHistory);
  const sections = [
    {
      id: "open",
      title: adminOverviewText.sections.open,
      items: groups.open,
    },
    {
      id: "needs-attention",
      title: adminOverviewText.sections.needsAttention,
      items: groups.needsAttention,
    },
    {
      id: "completed",
      title: adminOverviewText.sections.completed,
      items: groups.completed,
    },
  ].filter((section) => section.items.length > 0);

  return (
    <>
      <AdminBreadcrumb current={adminOverviewText.page.title} />
      {sections.length === 0 ? (
        <OverviewEmptyState />
      ) : (
        <OverviewActionGroups sections={sections} />
      )}
    </>
  );
}
