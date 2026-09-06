import "server-only";

import { z } from "zod";
import type { AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { directoryIntegerSchema, type DirectoryCacheRequest, type DirectoryCacheResponse } from "../../contracts/student-directory-cache-contract";
import { getStudentDirectoryInitial } from "./student-directory-query";
import { StudentDirectoryReadError } from "./student-directory-read-error";
import { studentDirectoryCacheIdentity } from "../student-directory-cache-identity";
export { studentDirectoryCacheIdentity };

const totalSchema = z.object({ total_points: directoryIntegerSchema });
const rowSchema = z.object({ id: z.uuid(), student_point_totals: z.union([totalSchema, z.array(totalSchema).max(1), z.null()]) });

export async function getStudentDirectoryCacheRead(input: DirectoryCacheRequest, admin: AdminContext): Promise<DirectoryCacheResponse> {
  const identity = studentDirectoryCacheIdentity(admin);
  if (identity && input.identity === identity && input.studentIds) {
    const ids = input.studentIds;
    if (ids.length === 0) return { kind: "resume", identity, userId: admin.userId, points: [] };
    const supabase = await createServerSupabaseClient();
    // Existing authenticated RLS and FK relation; never use the service-role point RPC here.
    const { data, error } = await supabase.from("students")
      .select("id, student_point_totals(total_points)").in("id", ids).is("deleted_at", null);
    if (error) throw new StudentDirectoryReadError("학생 포인트를 확인하지 못했습니다.");
    const parsed = z.array(rowSchema).max(10).safeParse(data);
    if (!parsed.success) throw new StudentDirectoryReadError("학생 포인트 응답을 확인하지 못했습니다.", "contract");
    const unique = new Set(parsed.data.map(row => row.id));
    if (unique.size !== parsed.data.length || parsed.data.some(row => !ids.includes(row.id))) {
      throw new StudentDirectoryReadError("학생 포인트 대상을 확인하지 못했습니다.", "contract");
    }
    if (unique.size === ids.length) {
      return { kind: "resume", identity, userId: admin.userId, points: parsed.data.map(row => {
        const total = Array.isArray(row.student_point_totals) ? row.student_point_totals[0] : row.student_point_totals;
        return { id: row.id, rawPoints: total?.total_points ?? 0 };
      }) };
    }
    // A deleted/inaccessible student is not a zero-point student. Replace the whole first snapshot.
  }
  return { kind: "snapshot", identity, userId: admin.userId, snapshot: await getStudentDirectoryInitial({ filters: input.filters }, admin) };
}
