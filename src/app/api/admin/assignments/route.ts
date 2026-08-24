import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import {
  listAssignments,
} from "@/lib/services/admin-service";
import {
  AssignmentCreationError,
  createRegularAssignment,
} from "@/lib/services/regular-assignment-service";
import { assignmentSchema } from "@/lib/admin/regular-assignment-request";

export async function GET() {
  if (!(await getAdminContext())) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  try {
    return Response.json({ assignments: await listAssignments() });
  } catch {
    return jsonError("시험 배정 목록을 불러오지 못했습니다.", 503);
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const input = await parseJson(request, assignmentSchema);
  if (!input) {
    return jsonError("시험 범위와 설정을 확인해주세요.", 400);
  }

  try {
    const assignmentId = await createRegularAssignment(input, admin);
    return Response.json({ assignmentId }, { status: 201 });
  } catch (error) {
    if (error instanceof AssignmentCreationError) {
      if (error.reason === "conflict") {
        return jsonError(error.message, 409);
      }
      if (error.reason === "invalid_selection") {
        return jsonError(error.message, 422);
      }
    }
    return jsonError(
      "시험을 배정하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }
}
