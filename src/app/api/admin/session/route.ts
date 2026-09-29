import { withAuthenticationFailureResponse } from "@/lib/auth/route-authentication";
import { getAdminContext } from "@/lib/auth/admin";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { privateJsonError as jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import { createServerSupabaseClient, signOutAdminSession } from "@/lib/supabase/server";
import { adminLoginSchema } from "@/lib/validation";

const privateResponseHeaders = {
  "Cache-Control": "private, no-store",
};

export const POST = withAuthenticationFailureResponse(async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  const input = await parseJson(request, adminLoginSchema);
  if (!input) {
    return jsonError("이메일과 비밀번호를 확인해주세요.", 400);
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword(input);

    if (error) {
      if (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500 || error.status === 408 || error.status === 429) {
        return jsonError("로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
      }
      return jsonError("관리자 로그인 정보가 올바르지 않습니다.", 401);
    }

    const admin = await getAdminContext();
    if (!admin) {
      await supabase.auth.signOut({ scope: "local" });
      return jsonError("승인된 관리자 계정이 아닙니다.", 403);
    }

    return Response.json(
      { admin: { userId: admin.userId, displayName: admin.displayName } },
      { headers: privateResponseHeaders },
    );
  } catch {
    return jsonError("관리자 로그인을 처리하지 못했습니다.", 503);
  }
});

export const DELETE = withAuthenticationFailureResponse(async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  try {
    const { error } = await signOutAdminSession();
    if (error) return jsonError("로그아웃을 처리하지 못했습니다. 다시 시도해 주세요.", 503);
    return Response.json(
      { ok: true },
      { headers: privateResponseHeaders },
    );
  } catch {
    return jsonError("로그아웃을 처리하지 못했습니다.", 503);
  }
});
