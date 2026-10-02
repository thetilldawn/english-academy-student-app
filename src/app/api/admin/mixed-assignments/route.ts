import { withAuthenticationFailureResponse } from "@/lib/auth/route-authentication";
import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import {
  createMixedAssignment,
  MixedAssignmentError,
} from "@/lib/services/mixed-assignment-service";
import { mixedAssignmentSchema } from "@/lib/admin/mixed-assignment-request";
import { mixedMistakeSaveSchema } from "@/features/assignments/public-contracts";
import { saveMixedMistakeAssignment, NotebookAssignmentError } from "@/features/assignments/public-server";
import { z } from "zod";

export const POST = withAuthenticationFailureResponse(async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const raw = await parseJson(request, z.record(z.string(), z.unknown()));
  if (raw && "planVersion" in raw) {
    const parsed = mixedMistakeSaveSchema.safeParse(raw);
    if (!parsed.success) return jsonError("범위와 오답 시험 조건을 확인해 주세요.", 400);
    try {
      return Response.json(await saveMixedMistakeAssignment(admin.userId, parsed.data), { status: 201, headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      if (error instanceof NotebookAssignmentError) return jsonError(error.message, error.status, { code: error.code });
      return jsonError("혼합 시험 배정 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.", 503);
    }
  }
  const input = mixedAssignmentSchema.safeParse(raw);
  if (!input.success) {
    return jsonError("혼합 시험 조건을 확인해 주세요.", 400);
  }

  try {
    const assignmentId = await createMixedAssignment(input.data, admin);
    return Response.json(
      { assignmentId },
      {
        status: 201,
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    if (error instanceof MixedAssignmentError) {
      if (error.reason === "forbidden") {
        return jsonError("관리자 권한을 다시 확인해 주세요.", 403);
      }
      if (
        error.reason === "conflict" ||
        error.reason === "unavailable"
      ) {
        return jsonError(error.message, 409);
      }
      if (error.reason === "invalid_selection") {
        return jsonError(error.message, 422);
      }
    }
    return jsonError(
      "DAY+오답 시험을 배정하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }
});
