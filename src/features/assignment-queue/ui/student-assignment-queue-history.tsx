"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/design-system/primitives/button/button";
import {
  loadStudentAssignmentQueuePage,
  type QueueHistoryCursor,
  QueueResolutionError,
  type QueueResolutionResult,
} from "@/features/assignment-queue/api/queue-actions";
import type { VocabAssignmentQueueSummary } from "@/lib/admin/vocab-assignment-queue";

import { AssignmentQueueHistory } from "./assignment-queue-history";
import styles from "./student-assignment-queue-history.module.css";

function StudentAssignmentQueueHistoryPage({
  headingLevel,
  onHistoryChanged,
  studentId,
}: {
  headingLevel: 2 | 3;
  onHistoryChanged?: () => void;
  studentId: string;
}) {
  const [queues, setQueues] = useState<VocabAssignmentQueueSummary[]>([]);
  const [nextCursor, setNextCursor] =
    useState<QueueHistoryCursor | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [reloadRevision, setReloadRevision] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const requestVersion = ++requestVersionRef.current;
    void loadStudentAssignmentQueuePage(studentId, null, controller.signal)
      .then((page) => {
        if (
          controller.signal.aborted ||
          requestVersionRef.current !== requestVersion
        ) return;
        setQueues(page.queues);
        setNextCursor(page.nextCursor);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "배정된 시험 내역을 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (
          requestRef.current === controller &&
          requestVersionRef.current === requestVersion
        ) {
          requestRef.current = null;
          if (!controller.signal.aborted) setInitialLoading(false);
        }
      });
    return () => {
      controller.abort();
      if (requestRef.current === controller) requestRef.current = null;
    };
  }, [reloadRevision, studentId]);

  function recoverLatestPage(error: unknown) {
    const shouldRecover = !(error instanceof QueueResolutionError) ||
      error.status === 409 ||
      error.status === 503;
    if (!shouldRecover) return;

    // The command may have committed before its response was lost. Reload the
    // receipt view, but never repeat the command automatically.
    setError("");
    setLoadingMore(false);
    setReloadRevision((current) => current + 1);
  }

  function applyResolution(result: QueueResolutionResult) {
    setQueues((current) => {
      const currentQueue = current.find(
        (queue) => queue.seriesId === result.queue.seriesId,
      );
      if (currentQueue && currentQueue.updatedAt > result.version) {
        return current;
      }
      return [
        result.queue,
        ...current.filter((queue) => queue.seriesId !== result.queue.seriesId),
      ].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.seriesId.localeCompare(left.seriesId)
      );
    });
    if (result.resolution.action !== "cancel") onHistoryChanged?.();
  }

  async function loadMore() {
    if (!nextCursor || loadingMore || requestRef.current) return;
    setLoadingMore(true);
    setError("");
    const controller = new AbortController();
    requestRef.current = controller;
    const requestVersion = ++requestVersionRef.current;
    try {
      const page = await loadStudentAssignmentQueuePage(
        studentId,
        nextCursor,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        requestVersionRef.current !== requestVersion
      ) return;
      setQueues((current) => {
        const knownIds = new Set(current.map((queue) => queue.seriesId));
        return [
          ...current,
          ...page.queues.filter((queue) => !knownIds.has(queue.seriesId)),
        ];
      });
      setNextCursor(page.nextCursor);
    } catch (requestError) {
      if (controller.signal.aborted) return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : "배정된 시험 내역을 불러오지 못했습니다.",
      );
    } finally {
      if (
        requestRef.current === controller &&
        requestVersionRef.current === requestVersion
      ) {
        requestRef.current = null;
        setLoadingMore(false);
      }
    }
  }

  if (initialLoading) {
    return <p className={styles.state}>배정된 시험 내역을 불러오는 중...</p>;
  }
  if (queues.length === 0 && !error) return null;

  return (
    <div className={styles.wrapper}>
      <AssignmentQueueHistory
        headingLevel={headingLevel}
        onResolutionError={recoverLatestPage}
        onResolved={applyResolution}
        queues={queues}
      />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {queues.length === 0 ? (
        <Button
          onClick={() => {
            setInitialLoading(true);
            setError("");
            setReloadRevision((current) => current + 1);
          }}
          size="small"
          variant="quiet"
        >
          다시 불러오기
        </Button>
      ) : null}
      {nextCursor ? (
        <Button
          disabled={loadingMore}
          onClick={() => void loadMore()}
          size="small"
          variant="quiet"
        >
          {loadingMore ? "불러오는 중..." : "이전 이력 더 보기"}
        </Button>
      ) : null}
    </div>
  );
}

export function StudentAssignmentQueueHistory({
  headingLevel = 2,
  onHistoryChanged,
  studentId,
}: {
  headingLevel?: 2 | 3;
  onHistoryChanged?: () => void;
  studentId: string;
}) {
  return (
    <StudentAssignmentQueueHistoryPage
      headingLevel={headingLevel}
      key={studentId}
      onHistoryChanged={onHistoryChanged}
      studentId={studentId}
    />
  );
}
