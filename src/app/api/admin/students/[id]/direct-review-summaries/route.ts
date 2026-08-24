import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { jsonError } from "@/lib/http";
import {
  DirectReviewCandidateError,
  listStudentDirectReviewDatasetSummaries,
} from "@/lib/services/direct-review-candidate-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminContext();
  if (!admin) return jsonError("관리자 로그인이 필요합니다.", 401);

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return jsonError("학생 정보를 확인해 주세요.", 400);
  }

  try {
    const summaries = await listStudentDirectReviewDatasetSummaries(id, admin);
    return Response.json(
      { summaries },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof DirectReviewCandidateError) {
      if (error.reason === "forbidden") {
        return jsonError("관리자 권한을 다시 확인해 주세요.", 403);
      }
      if (error.reason === "unavailable") {
        return jsonError("활성 학생을 찾지 못했습니다.", 404);
      }
    }
    return jsonError("현재 오답 단어 수를 불러오지 못했습니다.", 503);
  }
}
