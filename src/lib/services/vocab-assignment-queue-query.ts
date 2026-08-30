import "server-only";

import { z } from "zod";

import type {
  VocabAssignmentQueueSummary,
  VocabAssignmentQueueUnitAllocation,
} from "@/lib/admin/vocab-assignment-queue";
import {
  decodeStoredVocabUnitAllocationRule,
} from "@/lib/admin/vocab-unit-allocation-rule";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { isVocabAssignmentQueueUnavailable } from "./vocab-assignment-queue-support";

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
    allocation_rule: z.unknown().nullable().optional().default(null),
    recurrence_weekdays: z.array(
      z.number().int().min(1).max(7),
    ).optional().default([]),
  })
  .strict();

export type VocabAssignmentQueueCursor = {
  seriesId: string;
  updatedAt: string;
};

function mapRow(row: z.infer<typeof rowSchema>): VocabAssignmentQueueSummary {
  const decodedRule = row.allocation_rule
    ? decodeStoredVocabUnitAllocationRule(row.allocation_rule)
    : null;
  if (row.allocation_rule && !decodedRule) {
    console.error("[vocab-assignment-queue] invalid stored allocation rule", {
      seriesId: row.series_id,
    });
  }
  const unitAllocation = decodedRule
    ? {
        mode: decodedRule.rule.mode,
        unitsPerSession: decodedRule.rule.unitsPerSession,
        weekdayUnitsPerSession: decodedRule.rule.weekdayUnitsPerSession as
          VocabAssignmentQueueUnitAllocation["weekdayUnitsPerSession"],
        recurrenceWeekdays: row.recurrence_weekdays as Array<
          1 | 2 | 3 | 4 | 5 | 6 | 7
        >,
      }
    : null;
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
    unitAllocation,
    items: row.items,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseVocabAssignmentQueueSummary(
  value: unknown,
): VocabAssignmentQueueSummary {
  const parsed = rowSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("배정된 시험 상태 응답을 확인하지 못했습니다.");
  }
  return mapRow(parsed.data);
}

export async function listVocabAssignmentQueueSummaries(options?: {
  before?: VocabAssignmentQueueCursor;
  includeClosed?: boolean;
  limit?: number;
  studentId?: string;
}, authenticatedAdmin?: AdminContext): Promise<VocabAssignmentQueueSummary[]> {
  if (!authenticatedAdmin) await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const parameters = {
    p_before_series_id: options?.before?.seriesId ?? null,
    p_before_updated_at: options?.before?.updatedAt ?? null,
    p_include_closed: options?.includeClosed ?? false,
    p_limit: options?.limit ?? null,
    p_student_id: options?.studentId ?? null,
  };
  let { data, error } = await supabase.rpc(
    "list_vocab_assignment_queue_summaries_v2",
    parameters,
  );
  if (error?.code === "42883" || error?.code === "PGRST202") {
    const fallback = await supabase.rpc(
      "list_vocab_assignment_queue_summaries_v1",
      parameters,
    );
    data = fallback.data;
    error = fallback.error;
  }
  if (error) {
    if (isVocabAssignmentQueueUnavailable(error)) return [];
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
}, authenticatedAdmin?: AdminContext) {
  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
  const rows = await listVocabAssignmentQueueSummaries({
    before: options.before,
    includeClosed: true,
    limit: pageSize + 1,
    studentId: options.studentId,
  }, authenticatedAdmin);
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
