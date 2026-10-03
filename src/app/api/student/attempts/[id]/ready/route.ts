import { z } from "zod";
import { withAuthenticationFailureResponse } from "@/lib/auth/route-authentication";
import { getStudentSession } from "@/lib/auth/student-session";
import { isSameOriginRequest, parseJson } from "@/lib/http";
import { beginQuizPreparation, QuizPreparationChangedError } from "@/features/quiz-player/public-server";
const json = (body: unknown, status=200) => Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
export const POST = withAuthenticationFailureResponse(async (request: Request, context: {params:Promise<{id:string}>}) => {
  if (!isSameOriginRequest(request)) return json({error:"허용되지 않은 요청입니다."},403);
  const session=await getStudentSession();
  if (!session) return json({error:"학생 인증이 필요합니다."},401);
  const {id}=await context.params;
  const body=await parseJson(request,z.object({kind:z.enum(["initial","retry"])}).strict());
  if (!z.uuid().safeParse(id).success || !body) return json({error:"시험 요청을 확인해 주세요."},400);
  try { return json(await beginQuizPreparation(session.studentId,id,body.kind)); }
  catch (error) {
    if (error instanceof QuizPreparationChangedError) return json({error:error.message,code:error.code},error.code==="quiz_new_attempts_paused"?503:409);
    return json({error:"시험을 준비하지 못했습니다. 다시 확인해 주세요."},503);
  }
});

