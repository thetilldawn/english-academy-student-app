import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import { setStudentStatus } from "@/lib/services/admin-student-command-service";

const statusSchema = z.object({
  status: z.enum(["active", "blocked"]),
});

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
    parseJson(request, statusSchema),
  ]);
  if (!z.uuid().safeParse(id).success || !input) {
    return jsonError("접속상태 요청이 올바르지 않습니다.", 400);
  }

  try {
    await setStudentStatus(id, input.status);
    return Response.json({ ok: true });
  } catch {
    return jsonError("학생 접속상태를 바꾸지 못했습니다.", 503);
  }
}
