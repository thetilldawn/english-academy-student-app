import type { Metadata } from "next";

import { AdminBreadcrumb } from "@/components/admin-breadcrumb";
import { AdminHistoryList } from "@/features/history/ui/admin-history-list";
import { adminHistoryText } from "@/content/ko/admin-history";
import { listAssignmentHistory } from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: adminHistoryText.page.title,
};

export default async function ResultsPage() {
  const history = await listAssignmentHistory();

  return (
    <>
      <AdminBreadcrumb current={adminHistoryText.page.title} />
      <AdminHistoryList items={history} showFilters />
    </>
  );
}
