import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminHistoryList } from "@/features/history/ui/admin-history-list";
import { adminHistoryText } from "@/content/ko/admin-history";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";
import { listAdminHistoryInitial } from "@/features/history/server/queries/admin-history-list-query";

export const metadata: Metadata = {
  title: adminHistoryText.page.title,
};

export default function ResultsPage() {
  return (
    <Suspense
      fallback={<RouteLoadingState label={adminHistoryText.page.loading} />}
    >
      <ResultsContent />
    </Suspense>
  );
}

async function ResultsContent() {
  const snapshot = await listAdminHistoryInitial({ currentOnly: false });

  return (
    <>
      <AdminHistoryList
        initialSnapshot={snapshot}
        showFilters
      />
    </>
  );
}
