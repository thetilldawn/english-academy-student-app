import { z } from "zod";

import { directoryCacheRequestSchema, directoryFiltersSchema } from "@/features/students/contracts/student-directory-cache-contract";
import { getStudentDirectoryCacheRead, studentDirectoryCacheIdentity } from "@/features/students/server/queries/student-directory-resume-query";
import {
  getStudentDirectoryInitial,
  getStudentDirectoryNextPage,
} from "@/features/students/server/queries/student-directory-query";
import { StudentDirectoryCursorError } from "@/features/students/server/student-directory-cursor";
import { AdminAuthenticationUnavailableError, getAdminContextOrThrow } from "@/lib/auth/admin";
import { isSameOriginRequest, privateJsonError } from "@/lib/http";

const requestSchema = z.discriminatedUnion("mode", [
  directoryCacheRequestSchema,
  z.object({ filters: directoryFiltersSchema, mode: z.literal("initial") }),
  z.object({
    cursor: z.string().min(1).max(1600),
    filters: directoryFiltersSchema,
    mode: z.literal("page"),
    cacheIdentity: z.string().regex(/^[a-f0-9]{64}$/u).nullable().optional(),
    cacheUserId: z.uuid().optional(),
  }).refine(value => (value.cacheIdentity !== undefined) === (value.cacheUserId !== undefined)),
]);

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return privateJsonError("허용되지 않은 요청입니다.", 403);
  }
  let admin;
  try {
    admin = await getAdminContextOrThrow(request.signal);
  } catch (error) {
    if (!(error instanceof AdminAuthenticationUnavailableError)) throw error;
    return privateJsonError("로그인 상태를 확인하지 못했습니다. 다시 불러와 주세요.", 503);
  }
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
    if (parsed.data.mode === "page" && parsed.data.cacheUserId && (
      parsed.data.cacheUserId !== admin.userId || parsed.data.cacheIdentity !== studentDirectoryCacheIdentity(admin)
    )) return privateJsonError("로그인을 다시 확인해 주세요.", 401);
    if (parsed.data.mode === "cache") {
      return Response.json(await getStudentDirectoryCacheRead(parsed.data, admin), { headers: { "Cache-Control": "private, no-store" } });
    }
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
