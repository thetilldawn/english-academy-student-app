import { z } from "zod";

import {
  AssignmentPreviousExamError,
  getAssignmentPreviousExam,
} from "@/features/assignments/server/queries/assignment-previous-exam-query";
import { getAdminContext } from "@/lib/auth/admin";
import { isSameOriginRequest, privateJsonError } from "@/lib/http";

const requestSchema = z
  .object({
    datasetId: z.uuid(),
    studentId: z.uuid(),
  })
  .strict();

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return privateJsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) return privateJsonError("관리자 로그인이 필요합니다.", 401);
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return privateJsonError("학생과 단어장을 확인해 주세요.", 400);
  }

  try {
    const previousExam = await getAssignmentPreviousExam(parsed.data, admin);
    return Response.json(
      { previousExam },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof AssignmentPreviousExamError) {
      return privateJsonError(error.message, 503);
    }
    console.error("[assignment-previous-exam] read failed", {
      message: error instanceof Error ? error.message : "unknown",
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return privateJsonError("최근 시험을 불러오지 못했습니다.", 503);
  }
}
