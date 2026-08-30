import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { isSameOriginRequest, jsonError } from "@/lib/http";
import {
  cancelStudentReviewAssignmentDraft,
  ReviewAssignmentDraftCancelError,
} from "@/lib/services/review-assignment-service";

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store",
};

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; draftId: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const { id, draftId } = await context.params;
  if (
    !z.uuid().safeParse(id).success ||
    !z.uuid().safeParse(draftId).success
  ) {
    return jsonError("취소할 재시험 준비를 확인해 주세요.", 400);
  }

  try {
    await cancelStudentReviewAssignmentDraft(id, draftId, admin);
    return Response.json(
      {
        status: "cancelled",
        queueDisposition: "pending",
      },
      { headers: privateNoStoreHeaders },
    );
  } catch (error) {
    if (error instanceof ReviewAssignmentDraftCancelError) {
      if (error.reason === "forbidden") {
        return jsonError("관리자 권한을 다시 확인해 주세요.", 403);
      }
      if (error.reason === "not_found") {
        return jsonError("재시험 준비를 찾지 못했습니다.", 404);
      }
      if (error.reason === "unavailable") {
        return jsonError(
          "이미 배정되었거나 만료된 재시험 준비는 취소할 수 없습니다.",
          409,
        );
      }
    }
    return jsonError(
      "재시험 준비를 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }
}
