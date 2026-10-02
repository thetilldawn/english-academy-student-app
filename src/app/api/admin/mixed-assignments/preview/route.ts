import { withAuthenticationFailureResponse } from "@/lib/auth/route-authentication";
import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import { mixedMistakePreviewInputSchema } from "@/features/assignments/public-contracts";
import { previewMixedMistakeAssignment, NotebookAssignmentError } from "@/features/assignments/public-server";

export const POST = withAuthenticationFailureResponse(async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return jsonError("허용되지 않은 요청입니다.", 403);
  const admin = await getAdminContext();
  if (!admin) return jsonError("관리자 로그인이 필요합니다.", 401);
  const input = await parseJson(request, mixedMistakePreviewInputSchema);
  if (!input) return jsonError("범위와 오답 시험 조건을 확인해 주세요.", 400);
  try {
    return Response.json(await previewMixedMistakeAssignment(admin.userId, input), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof NotebookAssignmentError) return jsonError(error.message, error.status, { code: error.code });
    return jsonError("혼합 시험을 미리 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
  }
});
