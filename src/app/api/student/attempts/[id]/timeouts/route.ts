import { z } from "zod";

import { getStudentSession } from "@/lib/auth/student-session";
import {
  currentTimeMilliseconds,
  millisecondsUntil,
} from "@/lib/deadline";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import { timeoutStudentQuestion } from "@/lib/services/quiz-service";
import { questionTimeoutSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }
  const student = await getStudentSession();
  if (!student) {
    return jsonError("학생 로그인이 필요합니다.", 401);
  }
  const { id } = await context.params;
  const input = await parseJson(request, questionTimeoutSchema);
  if (!z.uuid().safeParse(id).success || !input) {
    return jsonError("시간 초과 문제 정보를 확인해주세요.", 400);
  }
  try {
    const result = await timeoutStudentQuestion({
      studentId: student.studentId,
      attemptId: id,
      questionId: input.questionId,
      phase: input.phase,
    });
    return Response.json({
      ...result,
      timerRemainingMilliseconds: result.questionDeadlineAt
        ? millisecondsUntil(
            result.questionDeadlineAt,
            currentTimeMilliseconds(),
          ) ?? 0
        : null,
    }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return jsonError("시간 초과 상태를 저장하지 못했습니다.", 409);
  }
}
