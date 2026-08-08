import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import {
  createWrongWordWorksheetRequest,
  WrongWordWorksheetError,
} from "@/lib/services/wrong-word-worksheet-service";
import { createWrongWordWorksheetRequestSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

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
    parseJson(request, createWrongWordWorksheetRequestSchema),
  ]);
  if (!z.uuid().safeParse(id).success || !input) {
    return jsonError("학생과 선택한 오답 단어를 확인해 주세요.", 400);
  }

  try {
    const worksheetRequest = await createWrongWordWorksheetRequest(
      id,
      input.questionIds,
      admin,
    );
    return Response.json(
      {
        request: worksheetRequest,
        exportUrl: `/api/admin/worksheet-requests/${worksheetRequest.requestId}/export`,
      },
      {
        status: worksheetRequest.reused ? 200 : 201,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    if (error instanceof WrongWordWorksheetError) {
      if (error.reason === "forbidden") {
        return jsonError("관리자 권한을 다시 확인해 주세요.", 403);
      }
      if (error.reason === "not_found") {
        return jsonError("활성 학생을 찾지 못했습니다.", 404);
      }
      if (error.reason === "invalid_selection") {
        return jsonError(
          "현재 미해결 상태인 오답 단어만 선택해 주세요.",
          409,
        );
      }
    }
    return jsonError(
      "해석 시험지 요청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }
}
