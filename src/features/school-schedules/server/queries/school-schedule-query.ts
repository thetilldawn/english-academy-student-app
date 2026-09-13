import "server-only";
import { cache } from "react";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { requireStudentSession } from "@/lib/auth/student-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { schoolKeySchema, schoolScheduleBundleSchema, type SchoolScheduleOverview, type SchoolScheduleSummary } from "../../contracts/school-schedule";
import { buildSchoolSummary, schoolToday } from "../../domain/school-schedule";

const responseSchema = z.object({
  students: z.array(z.object({ id: z.uuid(), schoolKey: schoolKeySchema.nullable(), schoolName: z.string().nullable(), gradeLabel: z.string().nullable() }).strict()),
  bundles: z.array(schoolScheduleBundleSchema),
}).strict().refine(value => new Set(value.students.map(student => student.id)).size === value.students.length);
const failedSummary = (today: string): SchoolScheduleSummary => ({ status: "error", today, schoolKey: null, schoolName: null, gradeLabel: null, events: [] });

export async function getAdminSchoolScheduleMap(ids: string[], expectedProfiles: { id: string; schoolKey?: string | null; schoolName: string | null; gradeLabel: string | null }[] = []) {
  await requireAdmin();
  const today = schoolToday();
  if (ids.length === 0) return {} as Record<string, SchoolScheduleSummary>;
  z.array(z.uuid()).max(100).parse(ids);
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("get_admin_school_schedules_v1", { p_student_ids: ids });
    if (error) throw new Error("schedule-read");
    const parsed = responseSchema.parse(data);
    if (parsed.students.length !== ids.length || parsed.students.some(student => !ids.includes(student.id))) throw new Error("schedule-scope");
    return Object.fromEntries(parsed.students.map(({ id, ...profile }) => {
      const expected = expectedProfiles.find(student => student.id === id);
      const changed = expected && (expected.schoolName !== profile.schoolName || expected.gradeLabel !== profile.gradeLabel
        || (expected.schoolKey !== undefined && expected.schoolKey !== profile.schoolKey));
      return [id, changed ? failedSummary(today) : buildSchoolSummary(profile, parsed.bundles, today)];
    }));
  } catch {
    return Object.fromEntries(ids.map(id => [id, failedSummary(today)]));
  }
}

export async function getAdminSchoolScheduleOverview(): Promise<SchoolScheduleOverview> {
  await requireAdmin();
  const today = schoolToday();
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("get_admin_school_schedules_v1", { p_student_ids: null });
    if (error) throw new Error("schedule-read");
    const parsed = responseSchema.parse(data);
    const grouped = new Map<string, SchoolScheduleOverview["groups"][number]>();
    for (const { schoolKey, schoolName, gradeLabel } of parsed.students) {
      const key = JSON.stringify([schoolKey, schoolName, gradeLabel]);
      const group = grouped.get(key);
      if (group) group.studentCount++;
      else grouped.set(key, { studentCount: 1, summary: buildSchoolSummary({ schoolKey, schoolName, gradeLabel }, parsed.bundles, today) });
    }
    return { status: "ready", today, groups: [...grouped.values()].sort((a,b) => (a.summary.schoolName ?? "").localeCompare(b.summary.schoolName ?? "", "ko") || (a.summary.gradeLabel ?? "").localeCompare(b.summary.gradeLabel ?? "")) };
  } catch { return { status: "error", today, groups: [] }; }
}

// This function never accepts a browser-supplied student ID. React cache lasts one server render.
export const getCurrentStudentSchoolSchedule = cache(async (): Promise<SchoolScheduleSummary> => {
  const student = await requireStudentSession();
  const today = schoolToday();
  try {
    const { data, error } = await getServiceSupabaseClient().rpc("get_student_school_schedule_v1", { p_student_id: student.studentId });
    if (error) throw new Error("schedule-read");
    const parsed = responseSchema.parse(data);
    if (parsed.students.length !== 1 || parsed.students[0].id !== student.studentId) throw new Error("schedule-scope");
    const { schoolKey, schoolName, gradeLabel } = parsed.students[0];
    return buildSchoolSummary({ schoolKey, schoolName, gradeLabel }, parsed.bundles, today);
  } catch { return failedSummary(today); }
});
