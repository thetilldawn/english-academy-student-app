import { withAuthenticationFailureResponse } from "@/lib/auth/route-authentication";
import { z } from "zod";

import { StudentDashboardCursorError } from "@/features/student-dashboard/server/student-dashboard-cursor";
import { StudentDashboardReadError } from "@/features/student-dashboard/server/queries/student-dashboard-read-error";
import { getStudentDashboardSectionPage } from "@/features/student-dashboard/server/queries/student-dashboard-query";
import { getStudentSession } from "@/lib/auth/student-session";
import {
  isSameOriginRequest,
  parseJson,
  privateJsonError,
} from "@/lib/http";

const requestSchema = z.object({
  cursor: z.string().min(1).max(2048),
}).strict();

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store",
} as const;

export const POST = withAuthenticationFailureResponse(async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return privateJsonError("허용되지 않은 요청입니다.", 403);
  }
  const student = await getStudentSession();
  if (!student) {
    return privateJsonError("학생 인증이 필요합니다.", 401);
  }
  const input = await parseJson(request, requestSchema);
  if (!input) {
    return privateJsonError("시험 목록 페이지 기준을 확인해 주세요.", 400);
  }

  try {
    const page = await getStudentDashboardSectionPage(
      input.cursor,
      student,
    );
    return Response.json({ page }, { headers: privateNoStoreHeaders });
  } catch (error) {
    if (error instanceof StudentDashboardCursorError) {
      return privateJsonError(error.message, error.reason === "identity" ? 409 : 400);
    }
    if (error instanceof StudentDashboardReadError) {
      return privateJsonError(error.message, 503);
    }
    return privateJsonError(
      "다음 시험 목록을 불러오지 못했습니다.",
      503,
    );
  }
});
