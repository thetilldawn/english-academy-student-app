import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { jsonError } from "@/lib/http";
import { revealStudentCode } from "@/lib/services/admin-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await getAdminContext())) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return jsonError("학생 ID가 올바르지 않습니다.", 400);
  }

  try {
    return Response.json(
      { code: await revealStudentCode(id) },
      {
        headers: {
          "Cache-Control": "no-store, private",
          Vary: "Cookie",
        },
      },
    );
  } catch {
    return jsonError("학생코드를 불러오지 못했습니다.", 503);
  }
}
