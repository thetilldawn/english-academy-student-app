import {
  getStudentSession,
  renewCurrentStudentSession,
  revokeCurrentStudentSession,
} from "@/lib/auth/student-session";
import { isSameOriginRequest, parseJson } from "@/lib/http";
import { authenticateStudentCode } from "@/lib/services/student-login-service";
import { studentCodeLoginSchema } from "@/lib/validation";

const privateResponseHeaders = {
  "Cache-Control": "private, no-store",
};

function sessionJsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: privateResponseHeaders },
  );
}

export async function GET() {
  const session = await getStudentSession();

  if (!session) {
    return sessionJsonError("학생 인증이 필요합니다.", 401);
  }

  return Response.json(
    { student: session },
    { headers: privateResponseHeaders },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return sessionJsonError("허용되지 않은 요청입니다.", 403);
  }

  const input = await parseJson(request, studentCodeLoginSchema);
  if (!input) {
    return sessionJsonError("접속코드를 확인해주세요.", 400);
  }

  try {
    const result = await authenticateStudentCode(request, input.code);

    if (!result.ok) {
      return sessionJsonError(
        "접속코드를 확인해주세요.",
        result.rateLimited ? 429 : 401,
      );
    }

    return Response.json(
      { student: { displayName: result.displayName } },
      { headers: privateResponseHeaders },
    );
  } catch {
    return sessionJsonError("학생 인증을 처리하지 못했습니다.", 503);
  }
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) {
    return sessionJsonError("허용되지 않은 요청입니다.", 403);
  }

  try {
    const result = await renewCurrentStudentSession();
    if (result.status === "invalid") {
      return sessionJsonError("학생 인증이 필요합니다.", 401);
    }
    return Response.json(result, { headers: privateResponseHeaders });
  } catch {
    return sessionJsonError("학생 인증 갱신을 처리하지 못했습니다.", 503);
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) {
    return sessionJsonError("허용되지 않은 요청입니다.", 403);
  }

  await revokeCurrentStudentSession();
  return Response.json(
    { ok: true },
    { headers: privateResponseHeaders },
  );
}
