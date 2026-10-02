import "server-only";
import { z } from "zod";
import { getStudentSession } from "@/lib/auth/student-session";
import { withAuthenticationFailureResponse } from "@/lib/auth/route-authentication";
import { isSameOriginRequest, parseJson } from "@/lib/http";
import { localQuizRequestSchema } from "../contracts/local-quiz";
import { handleLocalQuizCommand, LocalQuizError } from "./local-quiz-service";
import { usesLocalQuiz } from "./local-quiz-protocol-query";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
export const handleLocalQuizRequest = withAuthenticationFailureResponse(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "허용되지 않은 요청입니다." }, 405);
  if (!isSameOriginRequest(request)) return json({ error: "허용되지 않은 요청입니다." }, 403);
  const session = await getStudentSession();
  if (!session) return json({ code: "login_required", error: "다시 로그인해 주세요. 답안은 기기에 보관돼 있습니다." }, 401);
  const input = await parseJson(request, localQuizRequestSchema);
  if (!input) return json({ error: "시험 요청 정보를 확인해 주세요." }, 400);
  try { return json(await handleLocalQuizCommand(session.studentId, input)); }
  catch (error) {
    return error instanceof LocalQuizError ? json({ code: error.code, error: error.message }, error.status)
      : json({ code: "local_quiz_unavailable", error: "시험 정보를 확인하지 못했습니다. 연결 후 다시 시도해 주세요." }, 503);
  }
});
export const handleLocalQuizProtocolRequest = withAuthenticationFailureResponse(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const session = await getStudentSession(); if (!session) return json({ error: "학생 인증이 필요합니다." }, 401);
  const { id } = await context.params; if (!z.uuid().safeParse(id).success) return json({ error: "시험을 찾지 못했습니다." }, 404);
  try { return json({ local: await usesLocalQuiz(session.studentId, id) }); }
  catch { return json({ error: "시험을 확인하지 못했습니다." }, 503); }
});
