import type { Metadata } from "next";

import {
  OverviewActionGroups,
} from "@/features/history/ui/overview-action-groups";
import { adminOverviewText } from "@/content/ko/admin-overview";
import { listAdminHistoryInitial } from "@/features/history/server/queries/admin-history-list-query";

export const metadata: Metadata = {
  title: adminOverviewText.page.title,
};

export default async function AdminDashboardPage() {
  const snapshot = await listAdminHistoryInitial({ currentOnly: true });
  const titleByGroup = {
    open: adminOverviewText.sections.open,
    needs_attention: adminOverviewText.sections.needsAttention,
    completed: adminOverviewText.sections.completed,
  } as const;
  const sections = snapshot.sections.map((section) => ({
    ...section,
    title: titleByGroup[section.groupKey as keyof typeof titleByGroup],
  }));

  return (
    <OverviewActionGroups
      revision={snapshot.snapshotAt}
      sections={sections}
    />
  );
}
