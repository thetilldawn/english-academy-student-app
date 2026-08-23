import "server-only";

import { z } from "zod";

import type { VocabAssignmentQueueSummary } from "@/lib/admin/vocab-assignment-queue";
import { requireAdmin } from "@/lib/auth/admin";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const itemSchema = z
  .object({
    id: z.uuid(),
    sequenceNumber: z.number().int().positive(),
    status: z.enum([
      "queued",
      "ready",
      "assigned",
      "completed",
      "attention",
      "cancelled",
    ]),
    questionCount: z.number().int().min(4).max(500),
    unitLabels: z.array(z.string()),
    plannedAvailableFrom: z.iso.datetime({ offset: true }),
    plannedAvailableUntil: z.iso.datetime({ offset: true }),
    effectiveAvailableFrom: z.iso.datetime({ offset: true }),
    effectiveAvailableUntil: z.iso.datetime({ offset: true }),
    assignmentId: z.uuid().nullable(),
    attentionReason: z.string().nullable(),
    materializedAt: z.iso.datetime({ offset: true }).nullable(),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

const rowSchema = z
  .object({
    series_id: z.uuid(),
    student_id: z.uuid(),
    status: z.enum(["active", "attention", "completed", "cancelled"]),
    attention_reason: z.string().nullable(),
    dataset_label: z.string(),
    range_label: z.string(),
    total_session_count: z.coerce.number().int().nonnegative(),
    completed_session_count: z.coerce.number().int().nonnegative(),
    remaining_session_count: z.coerce.number().int().nonnegative(),
    total_question_count: z.coerce.number().int().nonnegative(),
    remaining_question_count: z.coerce.number().int().nonnegative(),
    current_assignment_id: z.uuid().nullable(),
    next_available_from: z.iso.datetime({ offset: true }).nullable(),
    next_available_until: z.iso.datetime({ offset: true }).nullable(),
    items: z.array(itemSchema),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

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

export type VocabAssignmentQueueCursor = {
  seriesId: string;
  updatedAt: string;
};

function isQueueMigrationUnavailable(error: {
  code?: string;
  message: string;
}) {
  return error.code === "42883" ||
    error.code === "PGRST202" ||
    error.message.includes("list_vocab_assignment_queue_summaries_v1");
}

function mapRow(row: z.infer<typeof rowSchema>): VocabAssignmentQueueSummary {
  return {
    seriesId: row.series_id,
    studentId: row.student_id,
    status: row.status,
    attentionReason: row.attention_reason,
    datasetLabel: row.dataset_label,
    rangeLabel: row.range_label,
    totalSessionCount: row.total_session_count,
    completedSessionCount: row.completed_session_count,
    remainingSessionCount: row.remaining_session_count,
    totalQuestionCount: row.total_question_count,
    remainingQuestionCount: row.remaining_question_count,
    currentAssignmentId: row.current_assignment_id,
    nextAvailableFrom: row.next_available_from,
    nextAvailableUntil: row.next_available_until,
    items: row.items,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listVocabAssignmentQueueSummaries(options?: {
  before?: VocabAssignmentQueueCursor;
  includeClosed?: boolean;
  limit?: number;
  studentId?: string;
}): Promise<VocabAssignmentQueueSummary[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "list_vocab_assignment_queue_summaries_v1",
    {
      p_before_series_id: options?.before?.seriesId ?? null,
      p_before_updated_at: options?.before?.updatedAt ?? null,
      p_include_closed: options?.includeClosed ?? false,
      p_limit: options?.limit ?? null,
      p_student_id: options?.studentId ?? null,
    },
  );
  if (error) {
    if (isQueueMigrationUnavailable(error)) return [];
    throw new Error("배정된 시험 상태를 불러오지 못했습니다.");
  }
  const parsed = z.array(rowSchema).safeParse(data ?? []);
  if (!parsed.success) {
    throw new Error("배정된 시험 상태 응답을 확인하지 못했습니다.");
  }
  return parsed.data.map(mapRow);
}

export async function listStudentVocabAssignmentQueuePage(options: {
  before?: VocabAssignmentQueueCursor;
  pageSize?: number;
  studentId: string;
}) {
  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
  const rows = await listVocabAssignmentQueueSummaries({
    before: options.before,
    includeClosed: true,
    limit: pageSize + 1,
    studentId: options.studentId,
  });
  const queues = rows.slice(0, pageSize);
  const last = queues.at(-1);
  return {
    nextCursor:
      rows.length > pageSize && last
        ? { seriesId: last.seriesId, updatedAt: last.updatedAt }
        : null,
    queues,
  };
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
    if (isQueueMigrationUnavailable(error)) return [];
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
