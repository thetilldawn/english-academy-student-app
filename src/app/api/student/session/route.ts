import {
  getStudentSession,
  revokeCurrentStudentSession,
} from "@/lib/auth/student-session";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import { authenticateStudentCode } from "@/lib/services/student-login-service";
import { studentCodeLoginSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET() {
  const session = await getStudentSession();

  if (!session) {
    return jsonError("학생 인증이 필요합니다.", 401);
  }

  return Response.json({ student: session });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  const input = await parseJson(request, studentCodeLoginSchema);
  if (!input) {
    return jsonError("접속코드를 확인해주세요.", 400);
  }

  try {
    const result = await authenticateStudentCode(request, input.code);

    if (!result.ok) {
      return jsonError(
        "접속코드를 확인해주세요.",
        result.rateLimited ? 429 : 401,
      );
    }

    const supabase = await createServerSupabaseClient();
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      await revokeCurrentStudentSession("admin_signout_failed");
      return jsonError(
        "관리자 접속을 종료한 뒤 다시 인증해주세요.",
        503,
      );
    }
    return Response.json({ student: { displayName: result.displayName } });
  } catch {
    return jsonError("학생 인증을 처리하지 못했습니다.", 503);
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  await revokeCurrentStudentSession();
  return Response.json({ ok: true });
}
