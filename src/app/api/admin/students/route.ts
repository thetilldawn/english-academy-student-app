import { getAdminContext } from "@/lib/auth/admin";
import { AppConfigurationError } from "@/lib/env";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import {
  createStudent,
  listStudents,
  StudentCreationError,
} from "@/lib/services/admin-service";
import { createStudentSchema } from "@/lib/validation";

export async function GET() {
  if (!(await getAdminContext())) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  try {
    return Response.json({ students: await listStudents() });
  } catch (error) {
    console.error("[students-api] list failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "unknown",
    });
    return jsonError("학생 목록을 불러오지 못했습니다.", 503);
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  if (!(await getAdminContext())) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const input = await parseJson(request, createStudentSchema);
  if (!input) {
    return jsonError("학생 정보를 확인해주세요.", 400);
  }

  try {
    return Response.json(await createStudent(input), { status: 201 });
  } catch (error) {
    console.error("[students-api] create failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "unknown",
    });

    if (error instanceof AppConfigurationError) {
      return jsonError("학생 생성용 서버 설정을 확인해주세요.", 503);
    }
    if (
      error instanceof StudentCreationError &&
      error.reason === "dataset_unavailable"
    ) {
      return jsonError(
        "선택한 단어장을 사용할 수 없습니다. 목록을 새로고침해주세요.",
        409,
      );
    }

    return jsonError(
      "학생을 만들지 못했습니다. 잠시 후 다시 시도해주세요.",
      503,
    );
  }
}
