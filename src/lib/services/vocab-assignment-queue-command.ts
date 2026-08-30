import "server-only";

import { z } from "zod";

import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { isVocabAssignmentQueueUnavailable } from "./vocab-assignment-queue-support";
import { parseVocabAssignmentQueueSummary } from "./vocab-assignment-queue-query";

const resolutionSchema = z
  .object({
    action: z.enum(["retry", "skip", "cancel"]),
    series_id: z.uuid(),
    student_id: z.uuid(),
  })
  .strict();

const resolutionReceiptSchema = z.object({
  queue: z.unknown(),
  resolution: resolutionSchema,
}).strict();

export type VocabAssignmentQueueResolutionAction = z.infer<
  typeof resolutionSchema
>["action"];

export class VocabAssignmentQueueCommandError extends Error {
  constructor(
    public readonly reason: "conflict" | "database",
    message: string,
  ) {
    super(message);
    this.name = "VocabAssignmentQueueCommandError";
  }
}

export async function materializeReadyVocabAssignmentQueue(
  studentId: string,
) {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc(
    "materialize_ready_vocab_assignment_queue_v1",
    { p_student_id: studentId, p_limit: 10 },
  );
  if (error) {
    if (isVocabAssignmentQueueUnavailable(error)) return [];
    console.error("[vocab-assignment-queue] materialization failed", {
      code: error.code,
      message: error.message,
    });
    return [];
  }
  return Array.isArray(data) ? data : [];
}

export async function resolveVocabAssignmentQueueAttention(
  seriesId: string,
  action: VocabAssignmentQueueResolutionAction,
  authenticatedAdmin?: AdminContext,
) {
  if (!authenticatedAdmin) await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "resolve_vocab_assignment_queue_attention_v2",
    { p_action: action, p_series_id: seriesId },
  );
  if (error) {
    if (error.code === "P0002" || error.code === "22023") {
      throw new VocabAssignmentQueueCommandError(
        "conflict",
        "이미 처리되었거나 현재 처리할 수 없는 시험입니다.",
      );
    }
    throw new VocabAssignmentQueueCommandError(
      "database",
      "배정된 시험 상태를 처리하지 못했습니다.",
    );
  }
  const parsed = resolutionReceiptSchema.safeParse(data);
  if (!parsed.success) {
    throw new VocabAssignmentQueueCommandError(
      "database",
      "배정된 시험 처리 결과를 확인하지 못했습니다.",
    );
  }
  let queue;
  try {
    queue = parseVocabAssignmentQueueSummary(parsed.data.queue);
  } catch {
    throw new VocabAssignmentQueueCommandError(
      "database",
      "변경된 배정 시험 상태를 확인하지 못했습니다.",
    );
  }
  const resolution = parsed.data.resolution;
  if (
    queue.seriesId !== seriesId ||
    resolution.series_id !== seriesId ||
    resolution.action !== action ||
    resolution.student_id !== queue.studentId
  ) {
    throw new VocabAssignmentQueueCommandError(
      "database",
      "변경된 배정 시험 상태가 요청과 일치하지 않습니다.",
    );
  }
  return {
    queue,
    resolution,
    version: queue.updatedAt,
  };
}
