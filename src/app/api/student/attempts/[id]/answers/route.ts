import { z } from "zod";

import { getStudentSession } from "@/lib/auth/student-session";
import {
  currentTimeMilliseconds,
  millisecondsUntil,
} from "@/lib/deadline";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import { answerStudentQuestion } from "@/lib/services/quiz-service";
import { answerSchema } from "@/lib/validation";

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

  const [{ id }, input] = await Promise.all([
    context.params,
    parseJson(request, answerSchema),
  ]);
  if (!z.uuid().safeParse(id).success || !input) {
    return jsonError("답안 요청이 올바르지 않습니다.", 400);
  }

  try {
    const result = await answerStudentQuestion({
      studentId: session.studentId,
      attemptId: id,
      questionId: input.questionId,
      phase: input.phase,
      choiceIndex: input.choiceIndex,
    });
    return Response.json({
      ...result,
      timerRemainingMilliseconds: result.questionDeadlineAt
        ? millisecondsUntil(
            result.questionDeadlineAt,
            currentTimeMilliseconds(),
          ) ?? 0
        : null,
    });
  } catch {
    return jsonError("답안을 저장하지 못했습니다.", 409);
  }
}
