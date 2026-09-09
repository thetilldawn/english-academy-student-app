import { getAdminContext } from "@/lib/auth/admin";
import { privateJsonError, isSameOriginRequest } from "@/lib/http";
import {
  BulkAssignmentError,
  previewBulkAssignments,
} from "@/features/assignments/server/use-cases/bulk-assignment-service";
import { bulkAssignmentInputError, bulkAssignmentPreviewSchema } from "@/features/assignments/contracts/bulk-assignment-request";
import { BULK_PREVIEW_COUNTS_HEADER } from "@/features/assignments/contracts/bulk-assignment-response";
import { serializeBulkAssignmentPreview } from "@/features/assignments/api/response-adapters";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return privateJsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) {
    return privateJsonError("관리자 로그인이 필요합니다.", 401);
  }
  const parsed = bulkAssignmentPreviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = bulkAssignmentInputError(parsed.error);
    return privateJsonError(issue?.message ?? "학생 선택과 출제 조건을 확인해 주세요.", 400,
      issue ? { code: issue.code, fieldPath: issue.fieldPath } : {});
  }
  const input = parsed.data;

  try {
    const preview = await previewBulkAssignments(input, admin);
    return Response.json(serializeBulkAssignmentPreview(
      preview, request.headers.get(BULK_PREVIEW_COUNTS_HEADER) === "1",
    ), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof BulkAssignmentError) {
      return privateJsonError(
        error.message,
        error.reason === "invalid_selection"
          ? 422
          : error.reason === "conflict"
            ? 409
            : 503,
      );
    }
    return privateJsonError("학생별 다음 범위를 계산하지 못했습니다.", 503);
  }
}
