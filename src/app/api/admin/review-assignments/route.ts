import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }
  if (!(await getAdminContext())) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }
  return jsonError(
    "별도 오답 재시험 배정은 종료되었습니다. 단어 시험 관리의 ‘단어 배정’에서 오답을 포함해 배정해 주세요.",
    410,
  );
}
