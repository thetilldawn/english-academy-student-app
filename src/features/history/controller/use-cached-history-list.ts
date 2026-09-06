"use client";
import { usePrivateListEntry } from "@/features/session/public-client";
import { historyFailureKind, type AdminHistoryFailureKind } from "../contracts/admin-history-request-error";
import type { HistoryCacheSeed } from "../contracts/history-list-cache-contract";
import { useHistoryListCache } from "./history-list-cache-provider";

export function useCachedHistoryList(seed?: HistoryCacheSeed) {
  const context = useHistoryListCache();
  const entry = usePrivateListEntry(context, seed, "history", historyFailureKind, "unavailable" as AdminHistoryFailureKind);
  return { ...entry, refresh: context?.refresh ?? entry.retry };
}
