import "server-only";

import type { AdminContext } from "@/lib/auth/admin";
import { requireAdmin } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { createVocabTimeTemplateSchema } from "@/lib/validation";
import type { z } from "zod";

export type VocabTimeTemplateInput = z.infer<
  typeof createVocabTimeTemplateSchema
>;

export type VocabTimeTemplateSummary = {
  id: string;
  name: string;
  availableTime: string;
  deadlineDayOffset: number;
  deadlineTime: string;
  timingMode: "none" | "total" | "per_question";
  totalSeconds: number | null;
  perQuestionSeconds: number | null;
};

type VocabTimeTemplateRow = {
  id: string;
  name: string;
  available_time: string;
  deadline_day_offset: number;
  deadline_time: string;
  timing_mode: "none" | "total" | "per_question";
  total_seconds: number | null;
  per_question_seconds: number | null;
};

const selectColumns = [
  "id",
  "name",
  "available_time",
  "deadline_day_offset",
  "deadline_time",
  "timing_mode",
  "total_seconds",
  "per_question_seconds",
].join(", ");

function toClockTime(value: string) {
  return value.slice(0, 5);
}

function mapTemplate(row: VocabTimeTemplateRow): VocabTimeTemplateSummary {
  return {
    id: row.id,
    name: row.name,
    availableTime: toClockTime(row.available_time),
    deadlineDayOffset: row.deadline_day_offset,
    deadlineTime: toClockTime(row.deadline_time),
    timingMode: row.timing_mode,
    totalSeconds: row.total_seconds,
    perQuestionSeconds: row.per_question_seconds,
  };
}

function isMissingTemplateTable(error: { code?: string; message: string }) {
  return error.code === "42P01" ||
    ((error.code ?? "").startsWith("PGRST") &&
      error.message.includes("admin_vocab_assignment_time_templates"));
}

export class VocabTimeTemplateError extends Error {
  constructor(
    readonly reason: "duplicate" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

export async function listVocabTimeTemplates(): Promise<
  VocabTimeTemplateSummary[]
> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("admin_vocab_assignment_time_templates")
    .select(selectColumns)
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingTemplateTable(error)) return [];
    throw new Error("시간 템플릿을 불러오지 못했습니다.");
  }
  return ((data ?? []) as unknown as VocabTimeTemplateRow[]).map(mapTemplate);
}

export async function createVocabTimeTemplate(
  input: VocabTimeTemplateInput,
  admin: AdminContext,
): Promise<VocabTimeTemplateSummary> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("admin_vocab_assignment_time_templates")
    .insert({
      name: input.name,
      available_time: input.availableTime,
      deadline_day_offset: input.deadlineDayOffset,
      deadline_time: input.deadlineTime,
      timing_mode: input.timingMode,
      total_seconds: input.totalSeconds,
      per_question_seconds: input.perQuestionSeconds,
      created_by: admin.userId,
    })
    .select(selectColumns)
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new VocabTimeTemplateError(
        "duplicate",
        "같은 이름의 시간 템플릿이 이미 있습니다.",
      );
    }
    throw new VocabTimeTemplateError(
      "unavailable",
      "시간 템플릿을 저장하지 못했습니다.",
    );
  }
  return mapTemplate(data as unknown as VocabTimeTemplateRow);
}
