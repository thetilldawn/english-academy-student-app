import "server-only";

import { z } from "zod";

import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const cancellationResultSchema = z.object({
  status: z.literal("cancelled"),
  assignmentId: z.uuid(),
  studentId: z.uuid(),
});

export class AssignmentCancellationError extends Error {
  constructor(
    public readonly reason:
      | "forbidden"
      | "started"
      | "missed"
      | "not_found"
      | "database",
    message: string,
  ) {
    super(message);
    this.name = "AssignmentCancellationError";
  }
}

export async function cancelStudentAssignment(
  assignmentId: string,
  studentId: string,
  authenticatedAdmin?: AdminContext,
) {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "cancel_student_assignment_v1",
    {
      p_assignment_id: assignmentId,
      p_student_id: studentId,
      p_reason: "관리자 취소",
    },
  );

  if (error) {
    const message = error.message ?? "";
    if (error.code === "42501") {
      throw new AssignmentCancellationError(
        "forbidden",
        "관리자 권한을 다시 확인해 주세요.",
      );
    }
    if (/assignment_already_started/.test(message)) {
      throw new AssignmentCancellationError(
        "started",
        "학생이 이미 응시를 시작해 취소할 수 없습니다.",
      );
    }
    if (/assignment_already_missed/.test(message)) {
      throw new AssignmentCancellationError(
        "missed",
        "이미 미응시 마감된 배정은 취소할 수 없습니다.",
      );
    }
    if (
      error.code === "P0002" ||
      /assignment_student_not_found/.test(message)
    ) {
      throw new AssignmentCancellationError(
        "not_found",
        "취소할 배정을 찾지 못했습니다.",
      );
    }
    console.error("[assignment-cancel] database operation failed", {
      code: error.code,
      message: error.message,
      hint: error.hint ?? null,
    });
    throw new AssignmentCancellationError(
      "database",
      "배정을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }

  const result = cancellationResultSchema.safeParse(data);
  if (!result.success) {
    throw new AssignmentCancellationError(
      "database",
      "배정 취소 결과를 확인하지 못했습니다.",
    );
  }
  return result.data;
}
