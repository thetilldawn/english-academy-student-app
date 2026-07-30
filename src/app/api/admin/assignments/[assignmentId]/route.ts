import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { isSameOriginRequest, jsonError } from "@/lib/http";
import {
  AdminDeletionError,
  deleteAssignment,
} from "@/lib/services/admin-deletion-service";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const { assignmentId } = await context.params;
  if (!z.uuid().safeParse(assignmentId).success) {
    return jsonError("시험 정보를 확인해 주세요.", 400);
  }

  try {
    return Response.json(
      await deleteAssignment(assignmentId, admin),
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    if (error instanceof AdminDeletionError) {
      const status =
        error.reason === "forbidden"
          ? 403
          : error.reason === "not_found"
            ? 404
            : error.reason === "in_progress"
              ? 409
              : 503;
      return jsonError(error.message, status);
    }
    return jsonError(
      "시험을 삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
      503,
    );
  }
}
