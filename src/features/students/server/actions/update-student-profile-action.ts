"use server";

import { z } from "zod";

import type { StudentProfileActionResult } from "../../contracts/student-mutation-result";
import { unstable_rethrow } from "next/navigation";
import { getAdminContextOrThrow } from "@/lib/auth/admin";
import {
  getStudentProfileMutationSnapshot,
  StudentProfileUpdateError,
  updateStudentProfile,
} from "@/lib/services/admin-student-command-service";
import { updateStudentProfileCommandSchema } from "@/lib/validation";

const inputSchema = updateStudentProfileCommandSchema.extend({
  studentId: z.uuid(),
});

export async function updateStudentProfileAction(
  input: unknown,
): Promise<StudentProfileActionResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "학생 정보를 확인해 주세요.",
      ok: false,
      status: 400,
    };
  }

  let admin;
  try { admin = await getAdminContextOrThrow(); }
  catch (error) {
    unstable_rethrow(error);
    return { ok: false, status: 503, error: "로그인 상태를 확인하지 못했습니다. 입력은 유지했습니다. 잠시 후 다시 저장해 주세요." };
  }
  if (!admin) {
    return {
      error: "관리자 로그인이 필요합니다.",
      ok: false,
      status: 401,
    };
  }

  try {
    const receipt = await updateStudentProfile(
      parsed.data.studentId,
      {
        baseVersion: parsed.data.baseVersion,
        displayName: parsed.data.displayName,
        gradeLabel: parsed.data.gradeLabel,
        schoolName: parsed.data.schoolName,
      },
      admin,
    );
    return {
      ok: true,
      receipt: {
        directoryEffect: "refresh-first-page",
        student: receipt.student,
        version: receipt.version,
      },
    };
  } catch (error) {
    unstable_rethrow(error);
    if (
      error instanceof StudentProfileUpdateError &&
      error.reason === "conflict"
    ) {
      try {
        const current = await getStudentProfileMutationSnapshot(
          parsed.data.studentId,
          admin,
        );
        return {
          current: {
            directoryEffect: "refresh-first-page",
            student: current,
            version: current.updatedAt,
          },
          error: "다른 변경이 먼저 저장되었습니다. 현재 입력을 확인한 뒤 다시 저장해 주세요.",
          ok: false,
          status: 409,
        };
      } catch {
        return {
          error: "최신 학생 정보를 불러오지 못했습니다.",
          ok: false,
          status: 503,
        };
      }
    }
    return {
      error: "학생 정보를 저장하지 못했습니다. 입력을 확인한 뒤 다시 시도해 주세요.",
      ok: false,
      status: 503,
      ...(!(error instanceof StudentProfileUpdateError) || error.reason === "unknown" ? { outcome: "unknown" as const } : {}),
    };
  }
}

// Read-only recovery: never repeat a possibly committed write automatically.
export async function readStudentProfileSaveResultAction(input: unknown): Promise<StudentProfileActionResult> {
  const parsed = z.object({ studentId: z.uuid() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, error: "학생을 확인해 주세요." };
  try {
    const admin = await getAdminContextOrThrow();
    if (!admin) return { ok: false, status: 401, error: "관리자 로그인이 필요합니다." };
    const student = await getStudentProfileMutationSnapshot(parsed.data.studentId, admin);
    return { ok: true, receipt: { directoryEffect: "refresh-first-page", student, version: student.updatedAt } };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, status: 503, error: "저장 결과를 불러오지 못했습니다. 입력은 유지했습니다. 다시 확인해 주세요." };
  }
}
