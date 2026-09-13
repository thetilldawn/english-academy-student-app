"use server";
import { z } from "zod";
import { unstable_rethrow } from "next/navigation";
import { getAdminContextOrThrow } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { scheduleEditCommandSchema, scheduleEditReceiptSchema, scheduleScopeSchema,
  type ScheduleFailure, type ScheduleReadResult, type ScheduleSaveResult, type ScheduleRecoveryResult } from "../../contracts/school-schedule-edit";
import { readSchoolScheduleEditor } from "../queries/school-schedule-editor-query";
import { getAdminSchoolScheduleOverview } from "../queries/school-schedule-query";

async function authorization(): Promise<ScheduleFailure | null> {
  try { return await getAdminContextOrThrow() ? null : { ok: false, status: 401, error: "관리자 로그인이 필요합니다." }; }
  catch (error) { unstable_rethrow(error); return { ok: false, status: 503, error: "로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." }; }
}
export async function readSchoolScheduleEditorAction(input: unknown): Promise<ScheduleReadResult> {
  const auth = await authorization(); if (auth) return auth;
  const parsed = scheduleScopeSchema.safeParse(input);
  return parsed.success ? readSchoolScheduleEditor(parsed.data) : { ok: false, status: 400, error: "학교와 학기를 확인해 주세요." };
}
export async function refreshSchoolScheduleOverviewAction() {
  const auth = await authorization(); if (auth) return auth;
  return { ok: true as const, overview: await getAdminSchoolScheduleOverview() };
}
export async function saveSchoolScheduleEventAction(input: unknown): Promise<ScheduleSaveResult> {
  const auth = await authorization(); if (auth) return auth;
  const parsed = scheduleEditCommandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, error: "일정 이름과 날짜를 확인해 주세요. 주·월 예정은 내용을 입력해 주세요." };
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("save_admin_school_schedule_event_v1", { p_input: parsed.data });
    if (error) {
      if (error.code === "42501") return { ok: false, status: 401, error: "관리자 로그인이 필요합니다." };
      if (error.code === "40001") return { ok: false, status: 409, error: "다른 수정이나 새 학교 자료가 있습니다. 최신 기준을 불러온 뒤 입력한 내용을 다시 검토해 주세요." };
      if (error.code === "P0002") return { ok: false, status: 404, error: "학교·학년의 학생 연결을 확인해 주세요. 입력은 유지했습니다." };
      if (["22023", "22007", "22008"].includes(error.code)) return { ok: false, status: 400, error: "일정 정보를 확인해 주세요. 같은 저장 요청의 내용을 변경할 수 없습니다." };
      throw error;
    }
    const receipt = scheduleEditReceiptSchema.parse(data);
    if (receipt.requestId !== parsed.data.requestId || receipt.eventId !== parsed.data.event.id || receipt.schoolKey !== parsed.data.schoolKey
      || receipt.academicYear !== parsed.data.academicYear || receipt.semester !== parsed.data.semester) throw new Error("receipt");
    return { ok: true, receipt };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, status: 503, outcome: "unknown", error: "저장 결과를 확인하지 못했습니다. 입력을 유지하고 중복 저장을 막았습니다." };
  }
}
export async function readSchoolScheduleSaveResultAction(input: unknown): Promise<ScheduleRecoveryResult> {
  const auth = await authorization(); if (auth) return auth;
  const parsed = z.object({ requestId: z.uuid() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, error: "저장 요청을 확인해 주세요." };
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("get_admin_school_schedule_edit_result_v1", { p_request_id: parsed.data.requestId });
    if (error) {
      if (error.code === "42501") return { ok: false, status: 401, error: "관리자 로그인이 필요합니다." };
      throw error;
    }
    const receipt = data === null ? null : scheduleEditReceiptSchema.parse(data);
    if (receipt && receipt.requestId !== parsed.data.requestId) throw new Error("receipt");
    return { ok: true, receipt };
  } catch (error) { unstable_rethrow(error); return { ok: false, status: 503, error: "저장 결과를 불러오지 못했습니다. 다시 확인해 주세요." }; }
}
