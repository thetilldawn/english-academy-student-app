import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import {
  BulkAssignmentError,
  createBulkAssignments,
} from "@/lib/services/bulk-assignment-service";
import { bulkAssignmentSchema } from "@/lib/admin/bulk-assignment-request";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }
  const input = await parseJson(request, bulkAssignmentSchema);
  if (!input) {
    return jsonError("일괄 배정 조건을 확인해 주세요.", 400);
  }

  try {
    const assignments = await createBulkAssignments(input, admin);
    return Response.json(
      { assignments },
      {
        status: 201,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    if (error instanceof BulkAssignmentError) {
      if (error.reason === "conflict") {
        return jsonError(error.message, 409);
      }
      if (error.reason === "invalid_selection") {
        return jsonError(error.message, 422);
      }
    }
    return jsonError("일괄 단어 시험을 배정하지 못했습니다.", 503);
  }
}
