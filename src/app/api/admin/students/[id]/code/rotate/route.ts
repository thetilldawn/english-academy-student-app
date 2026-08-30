import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest } from "@/lib/http";
import { rotateStudentCode } from "@/lib/services/admin-student-command-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  if (!(await getAdminContext())) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return jsonError("학생 ID가 올바르지 않습니다.", 400);
  }

  try {
    return Response.json(
      { code: await rotateStudentCode(id) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return jsonError("학생코드를 교체하지 못했습니다.", 503);
  }
}
