import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import {
  calculateAssignmentCapacity,
  MixedAssignmentError,
} from "@/lib/services/mixed-assignment-service";
import { assignmentCapacitySchema } from "@/lib/admin/assignment-replacement-request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const input = await parseJson(request, assignmentCapacitySchema);
  if (!input) {
    return jsonError("단원과 출제 조건을 확인해 주세요.", 400);
  }

  try {
    const capacity = await calculateAssignmentCapacity(input, admin);
    return Response.json(capacity, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof MixedAssignmentError) {
      const status =
        error.reason === "forbidden"
          ? 403
          : error.reason === "database"
            ? 503
            : 422;
      return jsonError(error.message, status);
    }
    return jsonError(
      "출제 가능한 문항 수를 계산하지 못했습니다.",
      503,
    );
  }
}
