import { directReviewPreviewSchema } from "@/lib/admin/direct-review-assignment-request";
import { getAdminContext } from "@/lib/auth/admin";
import { isSameOriginRequest, jsonError, parseJson } from "@/lib/http";
import {
  DirectReviewAssignmentError,
  previewDirectReviewAssignment,
} from "@/lib/services/direct-review-assignment-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) return jsonError("관리자 로그인이 필요합니다.", 401);

  const input = await parseJson(request, directReviewPreviewSchema);
  if (!input) return jsonError("오답 시험 범위를 확인해 주세요.", 400);

  try {
    const preview = await previewDirectReviewAssignment(input, admin);
    return Response.json(preview, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof DirectReviewAssignmentError) {
      const status = error.reason === "forbidden"
        ? 403
        : error.reason === "conflict" || error.reason === "unavailable"
          ? 409
        : error.reason === "database"
          ? 503
          : 422;
      return jsonError(error.message, status);
    }
    return jsonError("오답 시험 후보를 계산하지 못했습니다.", 503);
  }
}
