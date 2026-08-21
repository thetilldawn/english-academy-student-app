"use client";

import { useEffect, useState } from "react";

import { Button } from "@/design-system/primitives/button/button";
import {
  loadStudentAssignmentQueuePage,
  type QueueHistoryCursor,
} from "@/features/assignment-queue/api/queue-actions";
import type { VocabAssignmentQueueSummary } from "@/lib/admin/vocab-assignment-queue";

import { AssignmentQueueHistory } from "./assignment-queue-history";
import styles from "./student-assignment-queue-history.module.css";

function StudentAssignmentQueueHistoryPage({
  onRefresh,
  studentId,
}: {
  onRefresh: () => void;
  studentId: string;
}) {
  const [queues, setQueues] = useState<VocabAssignmentQueueSummary[]>([]);
  const [nextCursor, setNextCursor] =
    useState<QueueHistoryCursor | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void loadStudentAssignmentQueuePage(studentId, null, controller.signal)
      .then((page) => {
        setQueues(page.queues);
        setNextCursor(page.nextCursor);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "이어 배정 이력을 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setInitialLoading(false);
      });
    return () => controller.abort();
  }, [studentId]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const page = await loadStudentAssignmentQueuePage(
        studentId,
        nextCursor,
      );
      setQueues((current) => {
        const knownIds = new Set(current.map((queue) => queue.seriesId));
        return [
          ...current,
          ...page.queues.filter((queue) => !knownIds.has(queue.seriesId)),
        ];
      });
      setNextCursor(page.nextCursor);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "이어 배정 이력을 불러오지 못했습니다.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  if (initialLoading) {
    return <p className={styles.state}>이어 배정 이력을 불러오는 중...</p>;
  }
  if (queues.length === 0 && !error) return null;

  return (
    <div className={styles.wrapper}>
      <AssignmentQueueHistory
        onResolved={onRefresh}
        queues={queues}
      />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {queues.length === 0 ? (
        <Button
          onClick={onRefresh}
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
  studentId,
}: {
  studentId: string;
}) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  return (
    <StudentAssignmentQueueHistoryPage
      key={`${studentId}:${refreshVersion}`}
      onRefresh={() => setRefreshVersion((value) => value + 1)}
      studentId={studentId}
    />
  );
}
