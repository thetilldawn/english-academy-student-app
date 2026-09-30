import { withAuthenticationFailureResponse } from "@/lib/auth/route-authentication";
import { getStudentSession } from "@/lib/auth/student-session";
import { AuthenticationUnavailableError } from "@/lib/auth/authentication-error";
import { privateJsonError } from "@/lib/http";
import { getOwnWrongWordPage, OwnWrongWordReadError, WrongWordCursorError } from "@/features/students/public-server";
import { wrongWordFiltersFromSearchParams } from "@/features/students/public-contracts";

const allowedParams = new Set(["datasetId", "level", "query", "minWrongCount", "maxWrongCount", "cursor"]);

export const GET = withAuthenticationFailureResponse(async function GET(request: Request) {
  const student = await getStudentSession();
  if (!student) return privateJsonError("학생 인증이 필요합니다.", 401);
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !allowedParams.has(key) || params.getAll(key).length !== 1)) {
    return privateJsonError("오답 조회 조건을 확인해 주세요.", 400);
  }
  const filters = wrongWordFiltersFromSearchParams(params);
  if (!filters.success) return privateJsonError("오답 조회 조건을 확인해 주세요.", 400);
  try {
    const page = await getOwnWrongWordPage({ filters: filters.data, cursor: params.get("cursor") }, student);
    if (!page) return privateJsonError("학생 정보를 확인할 수 없습니다.", 404);
    return Response.json({ page }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationUnavailableError) throw error;
    if (error instanceof OwnWrongWordReadError && error.reason === "unauthenticated") {
      return privateJsonError(error.message, 401);
    }
    if (error instanceof WrongWordCursorError) {
      return privateJsonError(error.message, error.reason === "identity" ? 409 : 400);
    }
    return privateJsonError("오답 단어를 불러오지 못했습니다. 다시 시도해 주세요.", 503);
  }
});

