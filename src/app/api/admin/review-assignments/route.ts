import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import {
  createExactReviewAssignment,
  ReviewAssignmentError,
} from "@/lib/services/review-assignment-service";
import { exactReviewAssignmentSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const input = await parseJson(request, exactReviewAssignmentSchema);
  if (!input) {
    return jsonError("재시험 조건을 확인해 주세요.", 400);
  }

  try {
    const assignmentId = await createExactReviewAssignment(input, admin);
    return Response.json(
      { assignmentId },
      {
        status: 201,
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    if (error instanceof ReviewAssignmentError) {
      if (error.reason === "forbidden") {
        return jsonError("관리자 권한을 다시 확인해 주세요.", 403);
      }
      if (
        error.reason === "unavailable" ||
        error.reason === "conflict"
      ) {
        return jsonError(
          "재시험 초안이 만료되었거나 이미 사용되었습니다.",
          409,
        );
      }
      if (error.reason === "invalid_selection") {
        return jsonError(
          "선택한 단어의 출제 가능 방향과 시험 조건을 확인해 주세요.",
          422,
        );
      }
    }
    return jsonError(
      "오답 재시험을 배정하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }
}
