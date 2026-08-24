import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import {
  isSameOriginRequest,
  jsonError,
  parseJson,
} from "@/lib/http";
import {
  AdminDeletionError,
  deleteStudent,
} from "@/lib/services/admin-deletion-service";
import { updateStudentProfile } from "@/lib/services/admin-student-command-service";
import { updateStudentProfileSchema } from "@/lib/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const [{ id }, input] = await Promise.all([
    context.params,
    parseJson(request, updateStudentProfileSchema),
  ]);
  if (!z.uuid().safeParse(id).success || !input) {
    return jsonError("학생 정보를 확인해주세요.", 400);
  }

  try {
    await updateStudentProfile(id, input, admin);
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return jsonError("학생 정보를 저장하지 못했습니다.", 503);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return jsonError("학생 정보를 확인해 주세요.", 400);
  }

  try {
    return Response.json(await deleteStudent(id, admin), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AdminDeletionError) {
      const status =
        error.reason === "forbidden"
          ? 403
          : error.reason === "not_found"
            ? 404
            : 503;
      return jsonError(error.message, status);
    }
    return jsonError(
      "학생을 삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
      503,
    );
  }
}
