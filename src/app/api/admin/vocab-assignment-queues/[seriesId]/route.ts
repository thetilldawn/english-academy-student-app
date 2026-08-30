import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { isSameOriginRequest, jsonError, parseJson } from "@/lib/http";
import {
  resolveVocabAssignmentQueueAttention,
  VocabAssignmentQueueCommandError,
} from "@/lib/services/vocab-assignment-queue-command";

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
  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const [{ seriesId }, input] = await Promise.all([
    context.params,
    parseJson(request, resolutionSchema),
  ]);
  if (!z.uuid().safeParse(seriesId).success || !input) {
    return jsonError("배정된 시험 처리 요청을 확인해 주세요.", 400);
  }

  try {
    const result = await resolveVocabAssignmentQueueAttention(
      seriesId,
      input.action,
      admin,
    );
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (
      error instanceof VocabAssignmentQueueCommandError &&
      error.reason === "conflict"
    ) {
      return jsonError(error.message, 409);
    }
    return jsonError(
      "배정된 시험 상태를 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
      503,
    );
  }
}
