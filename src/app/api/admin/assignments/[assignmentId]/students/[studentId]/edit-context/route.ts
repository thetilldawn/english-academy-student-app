import { z } from "zod";

import {
  AssignmentEditContextError,
  getAssignmentEditContext,
} from "@/features/assignments/server/queries/assignment-edit-context-query";
import { getAdminContext } from "@/lib/auth/admin";
import { privateJsonError } from "@/lib/http";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ assignmentId: string; studentId: string }>;
  },
) {
  const admin = await getAdminContext();
  if (!admin) return privateJsonError("관리자 로그인이 필요합니다.", 401);
  const values = await params;
  const parsed = z.object({
    assignmentId: z.uuid(),
    studentId: z.uuid(),
  }).safeParse(values);
  if (!parsed.success) return privateJsonError("시험 정보를 확인해 주세요.", 400);
  try {
    const context = await getAssignmentEditContext(parsed.data, admin);
    return Response.json({ context }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AssignmentEditContextError) {
      return privateJsonError(
        error.message,
        error.reason === "not_found"
          ? 404
          : error.reason === "invalid_selection"
            ? 422
            : error.reason === "invalid_target"
              ? 409
              : 503,
      );
    }
    console.error("[assignment-edit-context] read failed", {
      message: error instanceof Error ? error.message : "unknown",
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return privateJsonError("수정 준비 자료를 불러오지 못했습니다.", 503);
  }
}
