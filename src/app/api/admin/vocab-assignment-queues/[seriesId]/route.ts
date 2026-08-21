import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { isSameOriginRequest, jsonError, parseJson } from "@/lib/http";
import { resolveVocabAssignmentQueueAttention } from "@/lib/services/vocab-assignment-queue-service";

const resolutionSchema = z
  .object({ action: z.enum(["retry", "skip", "cancel"]) })
  .strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ seriesId: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }
  if (!(await getAdminContext())) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const [{ seriesId }, input] = await Promise.all([
    context.params,
    parseJson(request, resolutionSchema),
  ]);
  if (!z.uuid().safeParse(seriesId).success || !input) {
    return jsonError("이어 배정 처리 요청을 확인해 주세요.", 400);
  }

  try {
    const result = await resolveVocabAssignmentQueueAttention(
      seriesId,
      input.action,
    );
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return jsonError(
      "이어 배정 상태를 처리하지 못했습니다. 다시 확인해 주세요.",
      409,
    );
  }
}
