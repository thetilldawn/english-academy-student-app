import "server-only";
import { z } from "zod";
import { getStudentSession } from "@/lib/auth/student-session";
import { withAuthenticationFailureResponse } from "@/lib/auth/route-authentication";
import { isSameOriginRequest, parseJson } from "@/lib/http";
import { practicePreviewInputSchema, practiceStartInputSchema } from "../contracts/practice";
import { getPractice, getPracticeHistory, PracticeError, practiceRpc, previewPractice, startPractice } from "./practice-service";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const answer = z.object({ questionId: z.uuid(), phase: z.literal("initial"), choiceIndex: z.number().int().min(0).max(3) }).strict();
const timeout = answer.omit({ choiceIndex: true });
const feedback = z.object({ nextQuestionId: z.uuid(), nextPhase: z.literal("initial"), transitionRemainingMilliseconds: z.number().int().min(0).max(750) }).strict();
type Context = { params: Promise<{ id?: string; command?: string }> };
export const handlePracticeRequest = withAuthenticationFailureResponse(async function handle(request: Request, context: Context, action?: "preview") {
  if (request.method !== "GET" && !isSameOriginRequest(request)) return json({ error: "허용되지 않은 요청입니다." }, 403);
  const session = await getStudentSession();
  if (!session) return json({ error: "학생 인증이 필요합니다." }, 401);
  const { id, command } = await context.params;
  if (id && !z.uuid().safeParse(id).success) return json({ error: "연습을 찾을 수 없습니다." }, 404);
  try {
    if (request.method === "GET") {
      if (command || action) return json({ error: "허용되지 않은 요청입니다." }, 405);
      const query = new URL(request.url).searchParams;
      if ([...query.keys()].some(key => key !== "cursor") || query.getAll("cursor").length > 1 || (query.get("cursor")?.length ?? 0) > 1000)
        return json({ error: "조회 조건을 확인해 주세요." }, 400);
      const data = id ? await getPractice(session.studentId, id) : await getPracticeHistory(session.studentId, query.get("cursor"));
      return data === null ? json({ error: "연습을 찾을 수 없습니다." }, 404) : json(data);
    }
    if (request.method !== "POST") return json({ error: "허용되지 않은 요청입니다." }, 405);
    if (!id) {
      if (action === "preview") {
        const input = await parseJson(request, practicePreviewInputSchema);
        return input ? json(await previewPractice(session.studentId, input)) : json({ error: "연습 설정을 확인해 주세요." }, 400);
      }
      const input = await parseJson(request, practiceStartInputSchema);
      return input ? json(await startPractice(session.studentId, input)) : json({ error: "연습 설정을 확인해 주세요." }, 400);
    }
    const params = { p_student_id: session.studentId, p_run_id: id };
    if (command === "answers" || command === "timeouts") {
      const input = await parseJson(request, command === "answers" ? answer : timeout);
      if (!input) return json({ error: "답안 요청을 확인해 주세요." }, 400);
      return json(await practiceRpc("answer_student_word_practice_v1", { ...params, p_question_id: input.questionId,
        p_choice_index: "choiceIndex" in input ? input.choiceIndex : null }));
    }
    if (command === "feedback") {
      const input = await parseJson(request, feedback);
      return input ? json(await practiceRpc("resume_student_word_practice_v1", { ...params, p_question_id: input.nextQuestionId,
        p_transition_ms: input.transitionRemainingMilliseconds })) : json({ error: "전환 요청을 확인해 주세요." }, 400);
    }
    if (command === "expire") return json(await practiceRpc("expire_student_word_practice_v1", params));
    return json({ error: "연습을 찾을 수 없습니다." }, 404);
  } catch (error) {
    return error instanceof PracticeError ? json({ error: error.message, code: error.code }, error.status) : json({ error: "연습을 불러오지 못했습니다. 다시 시도해 주세요." }, 503);
  }
});
