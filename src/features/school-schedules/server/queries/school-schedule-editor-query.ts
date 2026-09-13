import "server-only";
import { unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { scheduleScopeSchema, scheduleEditorSnapshotSchema, type ScheduleReadResult, type ScheduleScope, type ScheduleEditorInitial } from "../../contracts/school-schedule-edit";
import { getAdminSchoolScheduleOverview } from "./school-schedule-query";
import { schoolToday, schoolDisplayPeriod } from "../../domain/school-schedule";

export async function readSchoolScheduleEditor(scope: ScheduleScope): Promise<ScheduleReadResult> {
  await requireAdmin();
  const parsed = scheduleScopeSchema.safeParse(scope);
  if (!parsed.success) return { ok: false, status: 400, error: "학교와 학기를 확인해 주세요." };
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("get_admin_school_schedule_editor_v1", {
      p_school_key: parsed.data.schoolKey, p_academic_year: parsed.data.academicYear, p_semester: parsed.data.semester,
    });
    if (error) {
      if (error.code === "42501") return { ok: false, status: 401, error: "관리자 로그인이 필요합니다." };
      if (error.code === "P0002") return { ok: false, status: 404, error: "이 학교에 연결된 학생을 찾지 못했습니다. 학생 정보를 확인해 주세요." };
      throw error;
    }
    const snapshot = scheduleEditorSnapshotSchema.parse(data);
    if (snapshot.schoolKey !== scope.schoolKey || snapshot.academicYear !== scope.academicYear || snapshot.semester !== scope.semester) throw new Error("scope");
    return { ok: true, snapshot };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, status: 503, error: "일정을 불러오지 못했습니다. 다시 시도해 주세요." };
  }
}
export async function getSchoolScheduleEditorInitial(search: Record<string, string | string[] | undefined>): Promise<ScheduleEditorInitial> {
  await requireAdmin();
  const overview = await getAdminSchoolScheduleOverview();
  const period = schoolDisplayPeriod(schoolToday());
  const requestedSchool = typeof search.school === "string" ? search.school : null;
  const first = overview.groups.find(group => group.summary.schoolKey && /^(중|고)[123](학년)?$/.test((group.summary.gradeLabel ?? "").replace(/\s/g,"")));
  const key = requestedSchool ?? first?.summary.schoolKey;
  const candidate = { schoolKey: key, academicYear: period.academicYear, semester: search.semester === "1" ? 1 : search.semester === "2" ? 2 : period.semester };
  const parsed = scheduleScopeSchema.safeParse(candidate);
  const grade = /^[123]$/.test(String(search.grade)) ? Number(search.grade) : Number(first?.summary.gradeLabel?.replace(/\D/g,"") || 1);
  const scope = parsed.success ? parsed.data : null;
  return { overview, scope, grade, eventId: typeof search.event === "string" ? search.event : null, result: scope ? await readSchoolScheduleEditor(scope) : null };
}
