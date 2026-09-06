"use client";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";
import { adminHistoryText } from "@/content/ko/admin-history";
import type { HistoryCacheSeed } from "../contracts/history-list-cache-contract";
import { useCachedHistoryList } from "../controller/use-cached-history-list";
import { AdminHistoryList } from "./admin-history-list";
import { HistoryReadFailure } from "./history-read-failure";

export function CachedAdminHistoryList({ initialResponse }: { initialResponse?: HistoryCacheSeed }) {
  const entry = useCachedHistoryList(initialResponse);
  if (entry.blocked || entry.error) return <HistoryReadFailure failure={entry.blocked ? "unauthenticated" : entry.error!} expired={!entry.blocked && entry.expired} onRetry={entry.retry} />;
  if (!entry.snapshot) return <RouteLoadingState label={adminHistoryText.page.loading} />;
  return <AdminHistoryList key={entry.snapshot.snapshotAt} initialSnapshot={entry.snapshot} showFilters cacheEnabled onCursorRejected={entry.refresh} />;
}
