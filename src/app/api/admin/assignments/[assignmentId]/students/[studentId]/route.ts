import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import {
  isSameOriginRequest,
  jsonError,
  parseJson,
} from "@/lib/http";
import {
  AssignmentCancellationError,
  cancelStudentAssignment,
} from "@/lib/services/assignment-cancellation-service";
import {
  replaceStudentAssignment,
} from "@/lib/services/assignment-replacement-service";
import { calculateStudentAssignmentReplacementCapacity } from "@/lib/services/assignment-replacement-preparation-service";
import { getStudentAssignmentEditDraft } from "@/lib/services/assignment-edit-source-service";
import { AssignmentReplacementError } from "@/lib/services/assignment-replacement-errors";
import {
  assignmentReplacementPreviewSchema,
  assignmentReplacementSchema,
} from "@/lib/admin/assignment-replacement-request";

const paramsSchema = z.object({
  assignmentId: z.uuid(),
  studentId: z.uuid(),
});

export const dynamic = "force-dynamic";

function replacementErrorResponse(error: AssignmentReplacementError) {
  const status =
    error.reason === "forbidden"
      ? 403
      : error.reason === "not_found"
        ? 404
        : error.reason === "database"
          ? 503
          : error.reason === "invalid_selection"
            ? 422
            : 409;
  return jsonError(error.message, status, {
    code: error.code,
    fieldPath: error.fieldPath,
  });
}

async function parseAssignmentParams(
  params: Promise<{ assignmentId: string; studentId: string }>,
) {
  return paramsSchema.safeParse(await params);
}

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ assignmentId: string; studentId: string }>;
  },
) {
  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }
  const parsedParams = await parseAssignmentParams(params);
  if (!parsedParams.success) {
    return jsonError("배정 정보를 확인해 주세요.", 400);
  }
  const requestNowMilliseconds = Date.now();
  try {
    const draft = await getStudentAssignmentEditDraft(
      parsedParams.data.assignmentId,
      parsedParams.data.studentId,
      admin,
      { nowMilliseconds: requestNowMilliseconds },
    );
    return Response.json(draft, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AssignmentReplacementError) {
      return replacementErrorResponse(error);
    }
    return jsonError("수정할 배정 정보를 불러오지 못했습니다.", 503);
  }
}

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ assignmentId: string; studentId: string }>;
  },
) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }
  const parsedParams = await parseAssignmentParams(params);
  if (!parsedParams.success) {
    return jsonError("배정 정보를 확인해 주세요.", 400);
  }
  const input = await parseJson(
    request,
    assignmentReplacementPreviewSchema,
  );
  if (!input || input.studentId !== parsedParams.data.studentId) {
    return jsonError("수정할 범위와 출제 조건을 확인해 주세요.", 400);
  }
  const requestNowMilliseconds = Date.now();
  try {
    const capacity =
      await calculateStudentAssignmentReplacementCapacity(
        parsedParams.data.assignmentId,
        parsedParams.data.studentId,
        input,
        admin,
        { nowMilliseconds: requestNowMilliseconds },
      );
    return Response.json(capacity, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AssignmentReplacementError) {
      return replacementErrorResponse(error);
    }
    return jsonError("수정 가능한 문항 수를 계산하지 못했습니다.", 503);
  }
}

export async function PUT(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ assignmentId: string; studentId: string }>;
  },
) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }
  const parsedParams = await parseAssignmentParams(params);
  if (!parsedParams.success) {
    return jsonError("배정 정보를 확인해 주세요.", 400);
  }
  const input = await parseJson(request, assignmentReplacementSchema);
  if (!input) {
    return jsonError("수정할 시험 범위와 설정을 확인해 주세요.", 400);
  }
  const commandNowMilliseconds = Date.now();
  try {
    const result = await replaceStudentAssignment(
      parsedParams.data.assignmentId,
      parsedParams.data.studentId,
      input,
      admin,
      { commandNowMilliseconds },
    );
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AssignmentReplacementError) {
      return replacementErrorResponse(error);
    }
    return jsonError("배정을 수정하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
  }
}

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
  const parsedParams = await parseAssignmentParams(params);
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
