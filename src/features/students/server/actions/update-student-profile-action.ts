"use server";

import { z } from "zod";

import type { StudentProfileActionResult } from "../../contracts/student-mutation-result";
import { getAdminContext } from "@/lib/auth/admin";
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

  const admin = await getAdminContext();
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
          error: error.message,
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
      error: "학생 정보를 저장하지 못했습니다.",
      ok: false,
      status: 503,
    };
  }
}
