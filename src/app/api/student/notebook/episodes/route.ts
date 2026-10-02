import { withAuthenticationFailureResponse } from "@/lib/auth/route-authentication";
import { getStudentSession } from "@/lib/auth/student-session";
import { studentNotebookCacheIdentity } from "@/lib/auth/private-cache-identity";
import { privateJsonError } from "@/lib/http";
import { mistakeEpisodeHistorySearch } from "@/features/students/public-contracts";
import { getOwnMistakeEpisodeHistory, MistakeReadError } from "@/features/students/public-server";

export const GET = withAuthenticationFailureResponse(async function GET(request: Request) {
  const student = await getStudentSession();
  if (!student) return privateJsonError("다시 로그인해 주세요.", 401);
  const identity = studentNotebookCacheIdentity(student);
  if (request.headers.get("x-student-notebook-identity") !== identity) return privateJsonError("다시 로그인해 주세요.", 401);
  const input = mistakeEpisodeHistorySearch(new URL(request.url).searchParams);
  if (!input) return privateJsonError("조회 조건을 확인해 주세요.", 400);
  try {
    const page = await getOwnMistakeEpisodeHistory(input, student);
    if (!page) return privateJsonError("이 기록을 찾을 수 없습니다. 목록에서 다시 확인해 주세요.", 404);
    return Response.json({ page, identity }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof MistakeReadError) return privateJsonError(error.message,
      error.reason === "changed" ? 409 : error.reason === "invalid" ? 400 : error.reason === "unauthenticated" ? 401 : error.reason === "forbidden" ? 403 : 503);
    return privateJsonError("오답 이력을 불러오지 못했습니다. 다시 시도해 주세요.", 503);
  }
});
