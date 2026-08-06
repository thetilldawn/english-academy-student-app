import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import { previewBulkAssignments } from "@/lib/services/bulk-assignment-service";
import { bulkAssignmentPreviewSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }
  const input = await parseJson(request, bulkAssignmentPreviewSchema);
  if (!input) {
    return jsonError("학생 선택과 출제 조건을 확인해 주세요.", 400);
  }

  try {
    return Response.json(await previewBulkAssignments(input, admin), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return jsonError("학생별 다음 범위를 계산하지 못했습니다.", 503);
  }
}
