import { withAuthenticationFailureResponse } from "@/lib/auth/route-authentication";
import { getStudentSession } from "@/lib/auth/student-session";
import { privateJsonError } from "@/lib/http";
import { getNotebookPage, WrongWordCursorError } from "@/features/students/public-server";
import { notebookFiltersSchema, wrongWordFiltersFromSearchParams } from "@/features/students/public-contracts";
const allowed = new Set(["datasetId", "level", "query", "minWrongCount", "maxWrongCount", "sort", "cursor"]);
export const GET = withAuthenticationFailureResponse(async function GET(request: Request) {
  const student = await getStudentSession();
  if (!student) return privateJsonError("다시 로그인해 주세요.", 401);
  const params = new URL(request.url).searchParams;
  const base = wrongWordFiltersFromSearchParams(params);
  const filters = base.success ? notebookFiltersSchema.safeParse({ ...base.data, sort: params.get("sort") ?? "count" }) : null;
  if ([...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1) || !filters?.success) return privateJsonError("조회 조건을 확인해 주세요.", 400);
  try {
    const page = await getNotebookPage({ filters: filters.data, cursor: params.get("cursor") }, student);
    if (!page) return privateJsonError("학생 정보를 확인할 수 없습니다.", 404);
    return Response.json({ page }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof WrongWordCursorError) return privateJsonError(error.message, error.reason === "identity" ? 409 : 400);
    return privateJsonError("단어를 불러오지 못했습니다. 다시 시도해 주세요.", 503);
  }
});
