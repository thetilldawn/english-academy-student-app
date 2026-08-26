import "server-only";

import { z } from "zod";

import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const studentDeletionResultSchema = z.object({
  status: z.literal("deleted"),
  studentId: z.uuid(),
});

const assignmentDeletionResultSchema = z.object({
  status: z.literal("deleted"),
  assignmentId: z.uuid(),
});

const historyDeletionResultSchema = z.object({
  status: z.literal("hidden"),
  assignmentId: z.uuid(),
  studentId: z.uuid(),
  attemptId: z.uuid().nullable(),
});

export class AdminDeletionError extends Error {
  constructor(
    public readonly reason:
      | "forbidden"
      | "not_found"
      | "in_progress"
      | "conflict"
      | "database",
    message: string,
  ) {
    super(message);
    this.name = "AdminDeletionError";
  }
}

function mapDeletionError(
  error: {
    code?: string;
    message?: string;
    hint?: string | null;
  },
  operation: "student" | "assignment" | "history",
): never {
  const message = error.message ?? "";
  if (error.code === "42501") {
    throw new AdminDeletionError(
      "forbidden",
      "관리자 권한을 다시 확인해 주세요.",
    );
  }
  if (
    error.code === "P0002" ||
    /(?:student|assignment|history_entry)_not_found/.test(message)
  ) {
    throw new AdminDeletionError(
      "not_found",
      operation === "student"
        ? "삭제할 학생을 찾을 수 없습니다."
        : operation === "assignment"
          ? "삭제할 시험을 찾을 수 없습니다."
          : "삭제할 내역을 찾을 수 없습니다.",
    );
  }
  if (/assignment_has_in_progress_attempt/.test(message)) {
    throw new AdminDeletionError(
      "in_progress",
      "현재 응시 중인 학생이 있어 시험을 삭제할 수 없습니다. 응시가 끝난 뒤 다시 시도해 주세요.",
    );
  }
  if (/history_entry_stale/.test(message)) {
    throw new AdminDeletionError(
      "conflict",
      "학생이 방금 시험을 시작했습니다. 새로고침한 뒤 해당 응시 내역에서 다시 삭제해 주세요.",
    );
  }

  console.error("[admin-delete] database operation failed", {
    operation,
    code: error.code ?? "unknown",
    message,
    hint: error.hint ?? null,
  });
  throw new AdminDeletionError(
    "database",
    operation === "student"
      ? "학생을 삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요."
      : operation === "assignment"
        ? "시험을 삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요."
        : "내역을 삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
  );
}

export async function deleteStudent(
  studentId: string,
  authenticatedAdmin?: AdminContext,
) {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("delete_student_v2", {
    p_student_id: studentId,
  });

  if (error) {
    mapDeletionError(error, "student");
  }
  const result = studentDeletionResultSchema.safeParse(data);
  if (!result.success) {
    throw new AdminDeletionError(
      "database",
      "학생 삭제 결과를 확인하지 못했습니다.",
    );
  }
  return result.data;
}

export async function deleteAssignment(
  assignmentId: string,
  authenticatedAdmin?: AdminContext,
) {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("delete_assignment_v2", {
    p_assignment_id: assignmentId,
    p_reason: "관리자 삭제",
  });

  if (error) {
    mapDeletionError(error, "assignment");
  }
  const result = assignmentDeletionResultSchema.safeParse(data);
  if (!result.success) {
    throw new AdminDeletionError(
      "database",
      "시험 삭제 결과를 확인하지 못했습니다.",
    );
  }
  return result.data;
}

export async function hideAdminHistoryEntry(
  input: {
    assignmentId: string;
    studentId: string;
    attemptId: string | null;
  },
  authenticatedAdmin?: AdminContext,
) {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "hide_admin_history_entry_v1",
    {
      p_assignment_id: input.assignmentId,
      p_student_id: input.studentId,
      p_attempt_id: input.attemptId,
    },
  );

  if (error) {
    mapDeletionError(error, "history");
  }
  const result = historyDeletionResultSchema.safeParse(data);
  if (!result.success) {
    throw new AdminDeletionError(
      "database",
      "내역 삭제 결과를 확인하지 못했습니다.",
    );
  }
  return result.data;
}
