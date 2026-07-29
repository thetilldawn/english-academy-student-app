import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { jsonError } from "@/lib/http";
import { getAdminAttemptDetail } from "@/lib/services/admin-service";

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
    return jsonError("응시 정보를 확인해주세요.", 400);
  }

  const result = await getAdminAttemptDetail(id, admin);
  if (!result) {
    return jsonError("응시 내역을 찾지 못했습니다.", 404);
  }

  return Response.json({ result });
}
