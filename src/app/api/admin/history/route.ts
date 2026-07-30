import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import {
  isSameOriginRequest,
  jsonError,
  parseJson,
} from "@/lib/http";
import {
  AdminDeletionError,
  hideAdminHistoryEntry,
} from "@/lib/services/admin-deletion-service";

const historyDeletionSchema = z
  .object({
    assignmentId: z.uuid(),
    studentId: z.uuid(),
    attemptId: z.uuid().nullable(),
  })
  .strict();

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }
  const input = await parseJson(request, historyDeletionSchema);
  if (!input) {
    return jsonError("삭제할 내역을 확인해 주세요.", 400);
  }

  try {
    return Response.json(
      await hideAdminHistoryEntry(input, admin),
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
            : error.reason === "conflict"
              ? 409
            : 503;
      return jsonError(error.message, status);
    }
    return jsonError(
      "내역을 삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
      503,
    );
  }
}
