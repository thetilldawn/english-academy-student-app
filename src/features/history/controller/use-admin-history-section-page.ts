"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AdminHistoryListItem,
  AdminHistorySectionPage,
} from "@/features/history/contracts/admin-history-read-model";
import type { AdminHistoryStatusFilter } from "@/features/history/domain/learning-activity";
import { adminHistoryMutationImpact } from "@/features/history/domain/admin-history-mutation";
import {
  loadAdminHistoryFreshSection,
  loadAdminHistoryNextPage,
} from "@/features/history/transport/history-pages";

import { subscribeAdminHistoryMutation } from "./admin-history-mutation-events";

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
  const [totalCount, setTotalCount] = useState(section.totalCount);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => subscribeAdminHistoryMutation((notice) => {
    if (!loadMoreContext) return;
    const impact = adminHistoryMutationImpact(notice, loadMoreContext)
      .find((candidate) => candidate.groupKey === section.groupKey);
    if (!impact) return;

    requestRef.current?.abort();
    const requestVersion = ++requestVersionRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(false);
    setError("");
    // A mutation invalidates the old snapshot cursor immediately. If the
    // replacement request fails, keeping that cursor would allow a stale page
    // to be appended to the current list.
    setNextCursor(null);
    void loadAdminHistoryFreshSection(
      {
        ...loadMoreContext,
        groupKey: section.groupKey,
        mode: "section",
        snapshotAt: notice.receipt.version,
      },
      controller.signal,
    )
      .then((freshSection) => {
        if (
          controller.signal.aborted ||
          requestVersionRef.current !== requestVersion
        ) return;
        setItems(freshSection.items);
        setNextCursor(freshSection.nextCursor);
        setTotalCount(freshSection.totalCount);
      })
      .catch((requestError: unknown) => {
        if (
          controller.signal.aborted ||
          requestVersionRef.current !== requestVersion
        ) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "변경된 시험 내역을 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (
          requestRef.current === controller &&
          requestVersionRef.current === requestVersion
        ) {
          requestRef.current = null;
        }
      });
  }), [loadMoreContext, section.groupKey]);

  const loadMore = useCallback(async () => {
    if (!loadMoreContext || !nextCursor || requestRef.current) return;
    const controller = new AbortController();
    const requestVersion = ++requestVersionRef.current;
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
      if (
        controller.signal.aborted ||
        requestVersionRef.current !== requestVersion
      ) return;
      setItems((current) => mergeUniqueItems(current, page.items));
      setNextCursor(page.nextCursor);
    } catch (requestError) {
      if (
        controller.signal.aborted ||
        requestVersionRef.current !== requestVersion
      ) return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : "다음 시험 내역을 불러오지 못했습니다.",
      );
    } finally {
      if (
        requestRef.current === controller &&
        requestVersionRef.current === requestVersion
      ) {
        requestRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }, [loadMoreContext, nextCursor, section.groupKey]);

  return { error, items, loadMore, loading, nextCursor, totalCount };
}
