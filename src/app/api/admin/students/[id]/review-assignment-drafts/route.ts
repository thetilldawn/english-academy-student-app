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
    "이전 재시험 준비 방식은 종료되었습니다. 오답에서 ‘다음 시험에 추가’를 누른 뒤 시험 관리에서 ‘틀렸던 단어 추가’를 사용해 주세요.",
    410,
  );
}
