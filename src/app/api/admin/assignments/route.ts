import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import {
  createAssignment,
  listAssignments,
} from "@/lib/services/admin-service";
import { assignmentSchema } from "@/lib/validation";

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

  if (!(await getAdminContext())) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const input = await parseJson(request, assignmentSchema);
  if (!input) {
    return jsonError("시험 범위와 설정을 확인해주세요.", 400);
  }

  try {
    const assignmentId = await createAssignment(input);
    return Response.json({ assignmentId }, { status: 201 });
  } catch {
    return jsonError(
      "검수 완료된 어휘와 범위를 확인한 뒤 다시 시도해주세요.",
      503,
    );
  }
}
