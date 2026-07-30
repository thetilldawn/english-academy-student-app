import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { isSameOriginRequest, jsonError } from "@/lib/http";
import {
  AssignmentCancellationError,
  cancelStudentAssignment,
} from "@/lib/services/assignment-cancellation-service";

const paramsSchema = z.object({
  assignmentId: z.uuid(),
  studentId: z.uuid(),
});

export async function DELETE(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      assignmentId: string;
      studentId: string;
    }>;
  },
) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return jsonError("배정 정보를 확인해 주세요.", 400);
  }

  try {
    const result = await cancelStudentAssignment(
      parsedParams.data.assignmentId,
      parsedParams.data.studentId,
      admin,
    );
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AssignmentCancellationError) {
      const status =
        error.reason === "forbidden"
          ? 403
          : error.reason === "not_found"
            ? 404
            : error.reason === "database"
              ? 503
              : 409;
      return jsonError(error.message, status);
    }
    return jsonError(
      "배정을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }
}
