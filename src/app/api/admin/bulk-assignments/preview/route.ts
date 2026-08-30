import { getAdminContext } from "@/lib/auth/admin";
import { privateJsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import { previewBulkAssignments } from "@/features/assignments/server/use-cases/bulk-assignment-service";
import { bulkAssignmentPreviewSchema } from "@/features/assignments/contracts/bulk-assignment-request";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return privateJsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) {
    return privateJsonError("관리자 로그인이 필요합니다.", 401);
  }
  const input = await parseJson(request, bulkAssignmentPreviewSchema);
  if (!input) {
    return privateJsonError("학생 선택과 출제 조건을 확인해 주세요.", 400);
  }

  try {
    return Response.json(await previewBulkAssignments(input, admin), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return privateJsonError("학생별 다음 범위를 계산하지 못했습니다.", 503);
  }
}
