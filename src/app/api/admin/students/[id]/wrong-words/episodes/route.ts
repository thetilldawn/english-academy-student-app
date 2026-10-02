import { z } from "zod";
import { withAuthenticationFailureResponse } from "@/lib/auth/route-authentication";
import { getAdminContext } from "@/lib/auth/admin";
import { privateJsonError } from "@/lib/http";
import { mistakeEpisodeHistorySearch } from "@/features/students/public-contracts";
import { getAdminMistakeEpisodeHistory } from "@/features/students/server/queries/mistake-episode-history-query";
import { MistakeReadError } from "@/features/students/server/queries/mistake-episode-query";

export const GET = withAuthenticationFailureResponse(async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminContext();
  if (!admin) return privateJsonError("관리자 로그인이 필요합니다.", 401);
  const { id } = await context.params;
  const input = mistakeEpisodeHistorySearch(new URL(request.url).searchParams);
  if (!z.uuid().safeParse(id).success || !input) return privateJsonError("학생과 조회 조건을 확인해 주세요.", 400);
  try {
    const page = await getAdminMistakeEpisodeHistory(id, input, admin);
    if (!page) return privateJsonError("이 기록을 찾을 수 없습니다. 목록에서 다시 확인해 주세요.", 404);
    return Response.json({ page }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof MistakeReadError) return privateJsonError(error.message,
      error.reason === "changed" ? 409 : error.reason === "invalid" ? 400 : error.reason === "unauthenticated" ? 401 : error.reason === "forbidden" ? 403 : 503);
    return privateJsonError("오답 이력을 불러오지 못했습니다. 다시 시도해 주세요.", 503);
  }
});
