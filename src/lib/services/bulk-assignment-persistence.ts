import "server-only";

import { createHash } from "node:crypto";

import type { BulkAssignmentInput } from "@/lib/admin/bulk-assignment-request";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type BulkAssignmentPersistenceClient = Awaited<
  ReturnType<typeof createServerSupabaseClient>
>;

export function usesCompletionQueue(input: BulkAssignmentInput) {
  return input.commonPlan?.distribution === "split";
}

export function bulkAssignmentRequestSha256(input: BulkAssignmentInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        studentIds: [...input.studentIds].toSorted(),
        rangeMode: input.rangeMode,
        unitsPerSession: input.unitsPerSession,
        sessionCount: input.sessionCount,
        firstAvailableFrom: input.firstAvailableFrom,
        dayInterval: input.dayInterval,
        firstAvailableUntil: input.firstAvailableUntil,
        includePendingReview: input.includePendingReview,
        reviewLevels: [...input.reviewLevels].toSorted(),
        englishToKoreanRatio: input.englishToKoreanRatio,
        timeLimitSeconds: input.timeLimitSeconds,
        passingScore: input.passingScore,
        retryEnabled: input.retryEnabled,
        retryPassingScore: input.retryPassingScore,
        questionOrderMode: input.questionOrderMode,
        timingMode: input.timingMode,
        questionTimeLimitSeconds: input.questionTimeLimitSeconds,
        previewPlanSignature: input.previewPlanSignature,
        commonPlan: input.commonPlan
          ? {
              ...input.commonPlan,
              collisionDecisions: [...input.commonPlan.collisionDecisions]
                .toSorted((left, right) =>
                  left.collisionId.localeCompare(right.collisionId),
                ),
            }
          : null,
      }),
      "utf8",
    )
    .digest("hex");
}

export function bulkAssignmentResultMatchesBatches(
  result: ReadonlyArray<BulkAssignmentPersistenceResult>,
  batches: readonly Record<string, unknown>[],
  completionQueue = false,
) {
  const resultKeys = result
    .map((item) => `${item.student_id}:${item.session_number}`)
    .toSorted();
  const batchKeys = batches.map((batch) => {
    const studentId = batch.student_id;
    const sessionNumber = batch.session_number;
    return typeof studentId === "string" &&
        typeof sessionNumber === "number" &&
        Number.isInteger(sessionNumber) &&
        sessionNumber > 0
      ? `${studentId}:${sessionNumber}`
      : null;
  });
  return bulkAssignmentResultHasValidShape(result, completionQueue) &&
    batchKeys.every((key): key is string => key !== null) &&
    new Set(resultKeys).size === resultKeys.length &&
    new Set(batchKeys).size === batchKeys.length &&
    JSON.stringify(resultKeys) === JSON.stringify([...batchKeys].toSorted());
}

export type BulkAssignmentPersistenceResult = {
  student_id: string;
  assignment_id: string | null;
  queue_series_id?: string | null;
  queue_item_id?: string | null;
  session_number: number;
  status?: "assigned" | "queued";
};

export function bulkAssignmentResultHasValidShape(
  result: ReadonlyArray<BulkAssignmentPersistenceResult>,
  completionQueue: boolean,
) {
  if (!completionQueue) {
    return result.every((item) =>
      (item.status ?? "assigned") === "assigned" &&
      Boolean(item.assignment_id) &&
      !item.queue_series_id &&
      !item.queue_item_id
    );
  }

  const queueItemIds = result.map((item) => item.queue_item_id);
  if (
    queueItemIds.some((id) => !id) ||
    new Set(queueItemIds).size !== queueItemIds.length
  ) {
    return false;
  }
  const byStudent = new Map<string, BulkAssignmentPersistenceResult[]>();
  for (const item of result) {
    if (!item.queue_series_id) return false;
    const studentItems = byStudent.get(item.student_id) ?? [];
    studentItems.push(item);
    byStudent.set(item.student_id, studentItems);
  }
  return [...byStudent.values()].every((studentItems) => {
    const ordered = studentItems.toSorted(
      (left, right) => left.session_number - right.session_number,
    );
    const seriesId = ordered[0]?.queue_series_id;
    return Boolean(seriesId) &&
      ordered.every((item) => item.queue_series_id === seriesId) &&
      ordered.every((item, index) =>
        item.session_number === index + 1 &&
        (index === 0
          ? (item.status ?? "assigned") === "assigned" &&
            Boolean(item.assignment_id)
          : item.status === "queued" && item.assignment_id === null)
      );
  });
}

export async function lookupBulkAssignmentPersistence(input: {
  client: BulkAssignmentPersistenceClient;
  assignment: BulkAssignmentInput;
  requestSha256: string;
}) {
  return input.client.rpc(
    usesCompletionQueue(input.assignment)
      ? "get_vocab_assignment_queue_result_v1"
      : "get_bulk_vocab_series_result_v1",
    {
      p_idempotency_key: input.assignment.idempotencyKey,
      p_request_sha256: input.requestSha256,
    },
  );
}

export async function persistBulkAssignment(input: {
  client: BulkAssignmentPersistenceClient;
  assignment: BulkAssignmentInput;
  requestSha256: string;
  batches: readonly Record<string, unknown>[];
  queueSeries: readonly Record<string, unknown>[] | null;
}) {
  return usesCompletionQueue(input.assignment)
    ? input.client.rpc("create_vocab_assignment_queues_v2", {
        p_idempotency_key: input.assignment.idempotencyKey,
        p_request_sha256: input.requestSha256,
        p_series: input.queueSeries,
      })
    : input.client.rpc("create_bulk_vocab_assignments_v9", {
        p_idempotency_key: input.assignment.idempotencyKey,
        p_request_sha256: input.requestSha256,
        p_batches: input.batches,
      });
}
