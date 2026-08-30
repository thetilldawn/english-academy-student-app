import type { VocabAssignmentQueueSummary } from "@/lib/admin/vocab-assignment-queue";

export type QueueResolutionAction = "retry" | "skip" | "cancel";
export type QueueResolutionResult = {
  queue: VocabAssignmentQueueSummary;
  resolution: {
    action: QueueResolutionAction;
    series_id: string;
    student_id: string;
  };
  version: string;
};
export type QueueHistoryCursor = {
  seriesId: string;
  updatedAt: string;
};

export class QueueResolutionError extends Error {
  constructor(
    message: string,
    public readonly status: number = 503,
  ) {
    super(message);
    this.name = "QueueResolutionError";
  }
}

function isMatchingResolutionPayload(
  payload: {
    queue?: VocabAssignmentQueueSummary;
    resolution?: QueueResolutionResult["resolution"];
    version?: string;
  } | null,
  seriesId: string,
  action: QueueResolutionAction,
): payload is QueueResolutionResult {
  return Boolean(
    payload?.queue &&
    payload.resolution &&
    typeof payload.version === "string" &&
    payload.queue.seriesId === seriesId &&
    payload.resolution.series_id === seriesId &&
    payload.resolution.action === action &&
    payload.resolution.student_id === payload.queue.studentId &&
    payload.version === payload.queue.updatedAt,
  );
}

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
    queue?: VocabAssignmentQueueSummary;
    resolution?: QueueResolutionResult["resolution"];
    version?: string;
  } | null;
  if (!response.ok) {
    throw new QueueResolutionError(
      payload?.error ?? "배정된 시험 상태를 처리하지 못했습니다.",
      response.status,
    );
  }
  if (!isMatchingResolutionPayload(payload, seriesId, action)) {
    throw new QueueResolutionError("변경된 배정 시험 상태를 확인하지 못했습니다.");
  }
  return payload;
}
