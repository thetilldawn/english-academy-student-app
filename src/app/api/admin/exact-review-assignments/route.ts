import { getAdminContext } from "@/lib/auth/admin";
import {
  createDirectReviewAssignment,
  DirectReviewAssignmentError,
} from "@/lib/services/direct-review-assignment-service";
import { privateJsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import { directReviewAssignmentSchema } from "@/lib/admin/direct-review-assignment-request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return privateJsonError("허용되지 않은 요청입니다.", 403);
  }

  const admin = await getAdminContext();
  if (!admin) return privateJsonError("관리자 로그인이 필요합니다.", 401);

  const input = await parseJson(request, directReviewAssignmentSchema);
  if (!input) return privateJsonError("오답 시험 조건을 확인해 주세요.", 400);
  const commandNowMilliseconds = Date.now();

  try {
    const assignmentId = await createDirectReviewAssignment(input, admin, {
      commandNowMilliseconds,
    });
    return Response.json(
      { assignmentId },
      {
        status: 201,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    if (error instanceof DirectReviewAssignmentError) {
      if (error.reason === "forbidden") {
        return privateJsonError("관리자 권한을 다시 확인해 주세요.", 403);
      }
      if (error.reason === "conflict" || error.reason === "unavailable") {
        return privateJsonError(error.message, 409, { code: error.code });
      }
      if (error.reason === "invalid_selection") {
        return privateJsonError(error.message, 422, {
          fieldPath: error.fieldPath,
        });
      }
    }
    return privateJsonError(
      "오답 시험을 배정하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }
}
