import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { jsonError } from "@/lib/http";
import { getStudentWrongWordHistory } from "@/lib/services/wrong-word-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return jsonError("학생 정보를 확인해 주세요.", 400);
  }

  try {
    const history = await getStudentWrongWordHistory(id, admin);
    if (!history) {
      return jsonError("학생을 찾지 못했습니다.", 404);
    }
    return Response.json({ history });
  } catch {
    return jsonError("오답 단어 이력을 불러오지 못했습니다.", 500);
  }
}
