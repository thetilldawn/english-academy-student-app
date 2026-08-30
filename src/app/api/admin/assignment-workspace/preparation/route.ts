import { z } from "zod";

import {
  AssignmentPlannerPreparationError,
  getAssignmentPlannerPreparation,
} from "@/features/assignments/server/queries/assignment-planner-preparation-query";
import { getAdminContext } from "@/lib/auth/admin";
import { isSameOriginRequest, privateJsonError } from "@/lib/http";
import { MAXIMUM_BULK_STUDENT_COUNT } from "@/features/assignments/domain/model";

const requestSchema = z.object({
  initialDatasetId: z.union([z.literal(""), z.uuid()]).default(""),
  studentIds: z.array(z.uuid()).min(1).max(MAXIMUM_BULK_STUDENT_COUNT),
});

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
    return privateJsonError("배정할 학생을 확인해 주세요.", 400);
  }
  try {
    const preparation = await getAssignmentPlannerPreparation(
      parsed.data.studentIds,
      parsed.data.initialDatasetId,
      admin,
    );
    return Response.json({ preparation }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AssignmentPlannerPreparationError) {
      return privateJsonError(
        error.message,
        error.reason === "unavailable" ? 503 : 409,
      );
    }
    console.error("[assignment-planner-preparation] read failed", {
      message: error instanceof Error ? error.message : "unknown",
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return privateJsonError("배정 준비 자료를 불러오지 못했습니다.", 503);
  }
}
