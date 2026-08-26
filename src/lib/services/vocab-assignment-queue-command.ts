import "server-only";

import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { isVocabAssignmentQueueUnavailable } from "./vocab-assignment-queue-support";

const resolutionSchema = z
  .object({
    action: z.enum(["retry", "skip", "cancel"]),
    series_id: z.uuid(),
    student_id: z.uuid(),
  })
  .strict();

export type VocabAssignmentQueueResolutionAction = z.infer<
  typeof resolutionSchema
>["action"];

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
) {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "resolve_vocab_assignment_queue_attention_v1",
    { p_action: action, p_series_id: seriesId },
  );
  if (error) {
    throw new Error("배정된 시험 상태를 처리하지 못했습니다.");
  }
  const parsed = resolutionSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("배정된 시험 처리 결과를 확인하지 못했습니다.");
  }
  if (action !== "cancel") {
    await materializeReadyVocabAssignmentQueue(parsed.data.student_id);
  }
  return parsed.data;
}
