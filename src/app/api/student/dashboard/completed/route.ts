import { z } from "zod";

import { StudentDashboardCursorError } from "@/features/student-dashboard/server/student-dashboard-cursor";
import { StudentDashboardReadError } from "@/features/student-dashboard/server/queries/student-dashboard-read-error";
import { getStudentDashboardCompletedPage } from "@/features/student-dashboard/server/queries/student-dashboard-query";
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

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return privateJsonError("허용되지 않은 요청입니다.", 403);
  }
  const student = await getStudentSession();
  if (!student) {
    return privateJsonError("학생 인증이 필요합니다.", 401);
  }
  const input = await parseJson(request, requestSchema);
  if (!input) {
    return privateJsonError("완료 내역 페이지 기준을 확인해 주세요.", 400);
  }

  try {
    const page = await getStudentDashboardCompletedPage(
      input.cursor,
      student,
    );
    return Response.json({ page }, { headers: privateNoStoreHeaders });
  } catch (error) {
    if (error instanceof StudentDashboardCursorError) {
      return privateJsonError(error.message, 400);
    }
    if (error instanceof StudentDashboardReadError) {
      return privateJsonError(error.message, 503);
    }
    return privateJsonError(
      "다음 완료 시험을 불러오지 못했습니다.",
      503,
    );
  }
}

