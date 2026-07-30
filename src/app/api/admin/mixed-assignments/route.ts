import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import {
  createMixedAssignment,
  MixedAssignmentError,
} from "@/lib/services/mixed-assignment-service";
import { mixedAssignmentSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const input = await parseJson(request, mixedAssignmentSchema);
  if (!input) {
    return jsonError("혼합 시험 조건을 확인해 주세요.", 400);
  }

  try {
    const assignmentId = await createMixedAssignment(input, admin);
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
    if (error instanceof MixedAssignmentError) {
      if (error.reason === "forbidden") {
        return jsonError("관리자 권한을 다시 확인해 주세요.", 403);
      }
      if (
        error.reason === "conflict" ||
        error.reason === "unavailable"
      ) {
        return jsonError(error.message, 409);
      }
      if (error.reason === "invalid_selection") {
        return jsonError(error.message, 422);
      }
    }
    return jsonError(
      "DAY+오답 시험을 배정하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }
}
