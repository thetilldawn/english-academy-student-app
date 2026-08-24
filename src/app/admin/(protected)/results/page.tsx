import type { Metadata } from "next";

import { AdminHistoryList } from "@/features/history/ui/admin-history-list";
import { adminHistoryText } from "@/content/ko/admin-history";
import { listAssignmentHistory } from "@/lib/services/admin-history-read-service";

export const metadata: Metadata = {
  title: adminHistoryText.page.title,
};

export default async function ResultsPage() {
  const history = await listAssignmentHistory();

  return (
    <>
      <AdminHistoryList items={history} showFilters />
    </>
  );
}
