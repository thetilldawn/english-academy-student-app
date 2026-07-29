import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import { setStudentCurrentDataset } from "@/lib/services/admin-service";
import { updateStudentVocabSchema } from "@/lib/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  if (!(await getAdminContext())) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const [{ id }, input] = await Promise.all([
    context.params,
    parseJson(request, updateStudentVocabSchema),
  ]);
  if (!z.uuid().safeParse(id).success || !input) {
    return jsonError("학생과 단어장 정보를 확인해주세요.", 400);
  }

  try {
    await setStudentCurrentDataset(id, input.currentVocabDatasetId);
    return Response.json({ ok: true });
  } catch {
    return jsonError(
      "검수 완료된 단어장인지 확인한 뒤 다시 시도해주세요.",
      409,
    );
  }
}
