import type { VocabAssignmentQueueSummary } from "@/lib/admin/vocab-assignment-queue";

export type QueueResolutionAction = "retry" | "skip" | "cancel";
export type QueueHistoryCursor = {
  seriesId: string;
  updatedAt: string;
};

export async function loadStudentAssignmentQueuePage(
  studentId: string,
  before: QueueHistoryCursor | null,
  signal?: AbortSignal,
) {
  const search = new URLSearchParams();
  if (before) {
    search.set("beforeSeriesId", before.seriesId);
    search.set("beforeUpdatedAt", before.updatedAt);
  }
  const query = search.size > 0 ? `?${search.toString()}` : "";
  const response = await fetch(
    `/api/admin/students/${studentId}/vocab-assignment-queues${query}`,
    { cache: "no-store", signal },
  );
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    nextCursor?: QueueHistoryCursor | null;
    queues?: VocabAssignmentQueueSummary[];
  } | null;
  if (!response.ok || !payload?.queues) {
    throw new Error(
      payload?.error ?? "배정된 시험 내역을 불러오지 못했습니다.",
    );
  }
  return {
    nextCursor: payload.nextCursor ?? null,
    queues: payload.queues,
  };
}

export async function resolveAssignmentQueue(
  seriesId: string,
  action: QueueResolutionAction,
) {
  const response = await fetch(
    `/api/admin/vocab-assignment-queues/${seriesId}`,
    {
      body: JSON.stringify({ action }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    },
  );
  const payload = await response.json().catch(() => null) as {
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(
      payload?.error ?? "배정된 시험 상태를 처리하지 못했습니다.",
    );
  }
}
