import { withAuthenticationFailureResponse } from "@/lib/auth/route-authentication";
import { getStudentSession } from "@/lib/auth/student-session";
import { studentNotebookCacheIdentity } from "@/lib/auth/private-cache-identity";
import { privateJsonError } from "@/lib/http";
import { getMistakeStudyWord, MistakeReadError } from "@/features/students/public-server";

export const GET = withAuthenticationFailureResponse(async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const student=await getStudentSession();
  if (!student) return privateJsonError("다시 로그인해 주세요.",401);
  const identity=studentNotebookCacheIdentity(student);
  if (request.headers.get("x-student-notebook-identity")!==identity) return privateJsonError("다시 로그인해 주세요.",401);
  const params=new URL(request.url).searchParams,view=params.get("view")??"current",upper=params.get("upperVersion")??undefined;
  if ([...params.keys()].some(key=>!["view","upperVersion"].includes(key)||params.getAll(key).length!==1)
    || view!=="current"&&view!=="history" || upper!==undefined&&(!/^\d{1,19}$/.test(upper)||BigInt(upper)>BigInt("9223372036854775807")))
    return privateJsonError("조회 조건을 확인해 주세요.",400);
  try {
    const {id}=await context.params;
    const word=await getMistakeStudyWord(id,view,view==="history"?upper:undefined,student);
    if (!word) return privateJsonError("이 단어는 현재 목록에 없습니다. 목록에서 다시 확인해 주세요.",404);
    return Response.json({word,identity},{headers:{"Cache-Control":"private, no-store"}});
  } catch(error) {
    if (error instanceof MistakeReadError) return privateJsonError(error.message,
      error.reason==="changed"?409:error.reason==="invalid"?400:error.reason==="unauthenticated"?401:error.reason==="forbidden"?403:503);
    return privateJsonError("단어를 불러오지 못했습니다. 다시 시도해 주세요.",503);
  }
});
