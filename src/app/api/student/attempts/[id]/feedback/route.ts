import { z } from "zod";

import { getStudentSession } from "@/lib/auth/student-session";
import {
  currentTimeMilliseconds,
  millisecondsUntil,
} from "@/lib/deadline";
import { isSameOriginRequest, jsonError, parseJson } from "@/lib/http";
import { resumeStudentQuizAfterFeedback } from "@/lib/services/quiz/attempt-command";

const feedbackResumeSchema = z.object({
  nextPhase: z.enum(["initial", "retry"]),
  nextQuestionId: z.uuid(),
  transitionRemainingMilliseconds: z.number().int().min(0).max(750),
});

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
    parseJson(request, feedbackResumeSchema),
  ]);
  if (!z.uuid().safeParse(id).success || !input) {
    return jsonError("다음 문제 요청이 올바르지 않습니다.", 400);
  }

  try {
    const result = await resumeStudentQuizAfterFeedback({
      studentId: session.studentId,
      attemptId: id,
      nextPhase: input.nextPhase,
      nextQuestionId: input.nextQuestionId,
      transitionRemainingMilliseconds:
        input.transitionRemainingMilliseconds,
    });
    const now = currentTimeMilliseconds();
    return Response.json(
      {
        ...result,
        timerRemainingMilliseconds:
          millisecondsUntil(result.questionDeadlineAt, now) ?? 0,
        transitionRemainingMilliseconds:
          millisecondsUntil(result.questionStartsAt, now) ?? 0,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return jsonError("다음 문제 시간을 시작하지 못했습니다.", 409);
  }
}
