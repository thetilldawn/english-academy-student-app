import { z } from "zod";

import { getStudentSession } from "@/lib/auth/student-session";
import { jsonError, isSameOriginRequest } from "@/lib/http";
import { startStudentAttempt } from "@/lib/services/quiz/attempt-start";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  const session = await getStudentSession();
  if (!session) {
    return jsonError("학생 인증이 필요합니다.", 401);
  }

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return jsonError("시험 ID가 올바르지 않습니다.", 400);
  }

  try {
    const attemptId = await startStudentAttempt(session.studentId, id);
    return Response.json({ attemptId }, { status: 201 });
  } catch {
    return jsonError("시험을 시작할 수 없습니다.", 409);
  }
}
