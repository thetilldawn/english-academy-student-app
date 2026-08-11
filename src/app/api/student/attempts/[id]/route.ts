import { z } from "zod";

import { getStudentSession } from "@/lib/auth/student-session";
import {
  currentTimeMilliseconds,
  millisecondsUntil,
} from "@/lib/deadline";
import { jsonError } from "@/lib/http";
import { getStudentAttempt } from "@/lib/services/quiz-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getStudentSession();
  if (!session) {
    return jsonError("학생 인증이 필요합니다.", 401);
  }

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return jsonError("시험 ID가 올바르지 않습니다.", 400);
  }

  const attempt = await getStudentAttempt(session.studentId, id);
  if (!attempt) {
    return jsonError("시험을 찾지 못했습니다.", 404);
  }

  return Response.json({
    attempt,
    timerRemainingMilliseconds:
      millisecondsUntil(
        attempt.timerDeadlineAt,
        currentTimeMilliseconds(),
      ) ?? 0,
  });
}
