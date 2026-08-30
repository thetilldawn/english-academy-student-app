"use server";

import { z } from "zod";

import type { AdminHistoryHideActionResult } from "../../contracts/admin-history-mutation";
import { getAdminContext } from "@/lib/auth/admin";
import {
  AdminDeletionError,
  hideAdminHistoryEntry,
} from "@/lib/services/admin-deletion-service";

const inputSchema = z.object({
  assignmentId: z.uuid(),
  attemptId: z.uuid().nullable(),
  studentId: z.uuid(),
}).strict();

function deletionStatus(error: AdminDeletionError) {
  return error.reason === "forbidden"
    ? 403 as const
    : error.reason === "not_found"
      ? 404 as const
      : error.reason === "conflict"
        ? 409 as const
        : 503 as const;
}

export async function hideAdminHistoryEntryAction(
  input: unknown,
): Promise<AdminHistoryHideActionResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "삭제할 내역을 확인해 주세요.",
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
    const result = await hideAdminHistoryEntry(parsed.data, admin);
    return {
      ok: true,
      receipt: {
        assignmentId: result.assignmentId,
        attemptId: result.attemptId,
        kind: "hidden",
        studentId: result.studentId,
        version: result.hiddenAt,
      },
    };
  } catch (error) {
    if (error instanceof AdminDeletionError) {
      return {
        error: error.message,
        ok: false,
        status: deletionStatus(error),
      };
    }
    return {
      error: "내역을 삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
      ok: false,
      status: 503,
    };
  }
}
