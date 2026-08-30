"use client";

import { useEffect, useRef, useState } from "react";

import {
  normalizeAdminHistoryQuery,
  type AdminHistorySnapshot,
} from "@/features/history/contracts/admin-history-read-model";
import type { AdminHistoryStatusFilter } from "@/features/history/domain/learning-activity";
import { loadAdminHistorySnapshot } from "@/features/history/transport/history-pages";

const SEARCH_DELAY_MS = 300;

export function useAdminHistoryListController(
  initialSnapshot: AdminHistorySnapshot,
  {
    query,
    statusFilter,
  }: {
    query: string;
    statusFilter: AdminHistoryStatusFilter;
  },
) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryRevision, setRetryRevision] = useState(0);
  const requestRevisionRef = useRef(0);

  const normalizedQuery = normalizeAdminHistoryQuery(query);
  const conditionsMatchSnapshot =
    normalizedQuery === snapshot.query &&
    statusFilter === snapshot.statusFilter;

  useEffect(() => {
    if (conditionsMatchSnapshot) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      const requestRevision = ++requestRevisionRef.current;
      setLoading(true);
      setError("");
      void loadAdminHistorySnapshot(
        {
          currentOnly: initialSnapshot.currentOnly,
          mode: "initial",
          query: normalizedQuery,
          statusFilter,
        },
        controller.signal,
      )
        .then((nextSnapshot) => {
          if (
            !controller.signal.aborted &&
            requestRevisionRef.current === requestRevision
          ) setSnapshot(nextSnapshot);
        })
        .catch((requestError: unknown) => {
          if (
            controller.signal.aborted ||
            requestRevisionRef.current !== requestRevision
          ) return;
          setError(
            requestError instanceof Error
              ? requestError.message
              : "시험 내역을 불러오지 못했습니다.",
          );
        })
        .finally(() => {
          if (
            !controller.signal.aborted &&
            requestRevisionRef.current === requestRevision
          ) setLoading(false);
        });
    }, SEARCH_DELAY_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    conditionsMatchSnapshot,
    initialSnapshot.currentOnly,
    normalizedQuery,
    retryRevision,
    statusFilter,
  ]);

  return {
    error: conditionsMatchSnapshot ? "" : error,
    loading: conditionsMatchSnapshot ? false : loading,
    retry: () => setRetryRevision((revision) => revision + 1),
    snapshot,
  };
}
