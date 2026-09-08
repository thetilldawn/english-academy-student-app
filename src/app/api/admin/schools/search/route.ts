import { AdminAuthenticationUnavailableError, getAdminContextOrThrow } from "@/lib/auth/admin";
import { isSameOriginRequest, privateJsonError } from "@/lib/http";
import { getCurrentRequestContext } from "@/lib/observability/server-request-context";
import { ADMIN_INTERACTIVE_REQUEST_BUDGET_MS, awaitWithAbortSignal, createRequestDeadline, requestTimeoutWithinBudget } from "@/lib/network/request-policy";
import { schoolSearchMessages, schoolSearchRequestSchema, SchoolSearchRequestError } from "@/features/students/contracts/school-search-contract";
import { searchSchoolDirectory } from "@/features/students/server/queries/school-search-query";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return privateJsonError("허용되지 않은 요청입니다.", 403);
  const context = await getCurrentRequestContext();
  const deadline = createRequestDeadline(requestTimeoutWithinBudget(ADMIN_INTERACTIVE_REQUEST_BUDGET_MS, context.absoluteDeadlineAt), request.signal);
  try {
    const admin = await awaitWithAbortSignal(getAdminContextOrThrow(deadline.signal), deadline.signal);
    if (!admin) return privateJsonError(schoolSearchMessages.auth, 401);
    const body = await awaitWithAbortSignal(request.json().catch(() => null), deadline.signal);
    const input = schoolSearchRequestSchema.safeParse(body);
    if (!input.success) return privateJsonError(schoolSearchMessages.invalid, 400);
    const result = await searchSchoolDirectory(input.data.query, deadline.signal);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof AdminAuthenticationUnavailableError ? "로그인 상태를 확인하지 못했습니다. 잠시 후 다시 검색해 주세요."
      : error instanceof SchoolSearchRequestError ? error.message : schoolSearchMessages.error;
    return privateJsonError(message, 503);
  } finally { deadline.dispose(); }
}
