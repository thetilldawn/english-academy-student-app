import { withAuthenticationFailureResponse } from "@/lib/auth/route-authentication";
import { getStudentSession } from "@/lib/auth/student-session";
import { studentNotebookCacheIdentity } from "@/lib/auth/private-cache-identity";
import { privateJsonError } from "@/lib/http";
import { getNotebookPage, getMistakeStudyPage, MistakeReadError, WrongWordCursorError } from "@/features/students/public-server";
import { mistakeFiltersSchema, notebookFiltersSchema, wrongWordFiltersFromSearchParams } from "@/features/students/public-contracts";
const allowed = new Set(["datasetId", "level", "query", "minWrongCount", "maxWrongCount", "sort", "cursor", "view"]);
export const GET = withAuthenticationFailureResponse(async function GET(request: Request) {
  const student = await getStudentSession();
  if (!student) return privateJsonError("다시 로그인해 주세요.", 401);
  const params = new URL(request.url).searchParams;
  const base = wrongWordFiltersFromSearchParams(params);
  const filters = base.success ? notebookFiltersSchema.safeParse({ ...base.data, sort: params.get("sort") ?? "count" }) : null;
  if ([...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1) || !filters?.success) return privateJsonError("조회 조건을 확인해 주세요.", 400);
  try {
    const input = params.has("view") ? mistakeFiltersSchema.safeParse({ ...filters.data, view: params.get("view") }) : null;
    if (input && !input.success) return privateJsonError("조회 조건을 확인해 주세요.", 400);
    const identity = studentNotebookCacheIdentity(student);
    if (input?.success && request.headers.get("x-student-notebook-identity") !== identity) return privateJsonError("다시 로그인해 주세요.", 401);
    const page = input?.success ? await getMistakeStudyPage({ filters: input.data, cursor: params.get("cursor") }, student)
      : await getNotebookPage({ filters: filters.data, cursor: params.get("cursor") }, student);
    if (!page) return privateJsonError("학생 정보를 확인할 수 없습니다.", 404);
    return Response.json({ page, ...(input?.success ? { identity } : {}) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof MistakeReadError) return privateJsonError(error.message,
      error.reason === "changed" ? 409 : error.reason === "invalid" ? 400 : error.reason === "unauthenticated" ? 401 : error.reason === "forbidden" ? 403 : 503);
    if (error instanceof WrongWordCursorError) return privateJsonError(error.message, error.reason === "identity" ? 409 : 400);
    return privateJsonError("단어를 불러오지 못했습니다. 다시 시도해 주세요.", 503);
  }
});
