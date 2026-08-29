import { z } from "zod";

import {
  studentDirectoryStatuses,
  studentDirectoryWrongFilters,
} from "@/features/students/contracts/student-directory-read-model";
import {
  getStudentDirectoryInitial,
  getStudentDirectoryNextPage,
} from "@/features/students/server/queries/student-directory-query";
import { StudentDirectoryCursorError } from "@/features/students/server/student-directory-cursor";
import { getAdminContext } from "@/lib/auth/admin";
import { isSameOriginRequest, privateJsonError } from "@/lib/http";

const filtersSchema = z.object({
  classGroupId: z.union([z.literal(""), z.uuid()]),
  grade: z.string().max(40),
  query: z.string().max(80),
  school: z.string().max(120),
  status: z.enum(studentDirectoryStatuses),
  wordbook: z.string().max(160),
  wrong: z.enum(studentDirectoryWrongFilters),
});

const requestSchema = z.discriminatedUnion("mode", [
  z.object({ filters: filtersSchema, mode: z.literal("initial") }),
  z.object({
    cursor: z.string().min(1).max(1600),
    filters: filtersSchema,
    mode: z.literal("page"),
  }),
]);

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return privateJsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) {
    return privateJsonError("관리자 로그인이 필요합니다.", 401);
  }
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return privateJsonError("학생 목록 조건을 확인해 주세요.", 400);
  }
  try {
    const body = parsed.data.mode === "initial"
      ? { snapshot: await getStudentDirectoryInitial(parsed.data, admin) }
      : { page: await getStudentDirectoryNextPage(parsed.data, admin) };
    return Response.json(body, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof StudentDirectoryCursorError) {
      return privateJsonError(error.message, 409);
    }
    console.error("[student-directory-api] read failed", {
      message: error instanceof Error ? error.message : "unknown",
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return privateJsonError("학생 목록을 불러오지 못했습니다.", 503);
  }
}
