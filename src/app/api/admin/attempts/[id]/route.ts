import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { privateJsonError } from "@/lib/http";
import { getAdminAttemptDetail } from "@/features/history/public-server";

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store",
} as const;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminContext();
  if (!admin) {
    return privateJsonError("관리자 로그인이 필요합니다.", 401);
  }

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return privateJsonError("응시 정보를 확인해주세요.", 400);
  }

  let result;
  try {
    result = await getAdminAttemptDetail(id, admin);
  } catch {
    return privateJsonError(
      "응시 상세를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
      503,
    );
  }
  if (!result) {
    return privateJsonError("응시 내역을 찾지 못했습니다.", 404);
  }

  return Response.json(
    { result },
    { headers: privateNoStoreHeaders },
  );
}
