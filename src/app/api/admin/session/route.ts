import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { adminLoginSchema } from "@/lib/validation";

export async function POST(request: Request) {
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
      return jsonError("관리자 로그인 정보가 올바르지 않습니다.", 401);
    }

    const admin = await getAdminContext();
    if (!admin) {
      await supabase.auth.signOut();
      return jsonError("승인된 관리자 계정이 아닙니다.", 403);
    }

    return Response.json({ admin });
  } catch {
    return jsonError("관리자 로그인을 처리하지 못했습니다.", 503);
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  try {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
    return Response.json({ ok: true });
  } catch {
    return jsonError("로그아웃을 처리하지 못했습니다.", 503);
  }
}
