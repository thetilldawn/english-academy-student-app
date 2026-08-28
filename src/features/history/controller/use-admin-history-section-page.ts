"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AdminHistoryListItem,
  AdminHistorySectionPage,
} from "@/features/history/contracts/admin-history-read-model";
import type { AdminHistoryStatusFilter } from "@/features/history/domain/learning-activity";
import { loadAdminHistoryNextPage } from "@/features/history/transport/history-pages";

export type AdminHistoryLoadMoreContext = {
  currentOnly: boolean;
  query: string;
  statusFilter: AdminHistoryStatusFilter;
};

function mergeUniqueItems(
  current: readonly AdminHistoryListItem[],
  incoming: readonly AdminHistoryListItem[],
) {
  const known = new Set(current.map((item) => item.id));
  const appended = incoming.filter((item) => {
    if (known.has(item.id)) return false;
    known.add(item.id);
    return true;
  });
  return [...current, ...appended];
}

export function useAdminHistorySectionPage({
  loadMoreContext,
  section,
}: {
  loadMoreContext?: AdminHistoryLoadMoreContext;
  section: AdminHistorySectionPage;
}) {
  const [items, setItems] = useState(section.items);
  const [nextCursor, setNextCursor] = useState(section.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  const loadMore = useCallback(async () => {
    if (!loadMoreContext || !nextCursor || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const page = await loadAdminHistoryNextPage(
        {
          ...loadMoreContext,
          cursor: nextCursor,
          groupKey: section.groupKey,
          mode: "page",
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setItems((current) => mergeUniqueItems(current, page.items));
      setNextCursor(page.nextCursor);
    } catch (requestError) {
      if (controller.signal.aborted) return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : "다음 시험 내역을 불러오지 못했습니다.",
      );
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }, [loadMoreContext, nextCursor, section.groupKey]);

  return { error, items, loadMore, loading, nextCursor };
}
