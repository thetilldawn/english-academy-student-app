import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import {
  createStudentReviewAssignmentDraft,
  ReviewAssignmentDraftError,
} from "@/lib/services/wrong-word-service";
import { createReviewAssignmentDraftSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store",
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const [{ id }, input] = await Promise.all([
    context.params,
    parseJson(request, createReviewAssignmentDraftSchema),
  ]);
  if (!z.uuid().safeParse(id).success || !input) {
    return jsonError(
      "학생과 재시험에 배정할 오답 단어를 확인해 주세요.",
      400,
    );
  }

  try {
    const reviewDraftId = await createStudentReviewAssignmentDraft(
      id,
      input.questionIds,
      admin,
    );
    return Response.json(
      { reviewDraftId },
      { status: 201, headers: privateNoStoreHeaders },
    );
  } catch (error) {
    if (error instanceof ReviewAssignmentDraftError) {
      if (error.reason === "forbidden") {
        return jsonError("관리자 권한을 다시 확인해 주세요.", 403);
      }
      if (
        error.reason === "invalid_selection" ||
        error.reason === "conflict"
      ) {
        return jsonError(
          error.reason === "conflict"
            ? "선택한 단어가 다른 재시험 배정에서 사용 중입니다. 새로고침 후 다시 선택해 주세요."
            : "재시험 단어는 같은 단어장에서만 선택해 주세요.",
          409,
        );
      }
    }
    return jsonError(
      "재시험 배정을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }
}
