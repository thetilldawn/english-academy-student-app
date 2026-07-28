import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import {
  createStudent,
  listStudents,
} from "@/lib/services/admin-service";
import { createStudentSchema } from "@/lib/validation";

export async function GET() {
  if (!(await getAdminContext())) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  try {
    return Response.json({ students: await listStudents() });
  } catch {
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
  } catch {
    return jsonError("학생을 만들지 못했습니다.", 503);
  }
}
