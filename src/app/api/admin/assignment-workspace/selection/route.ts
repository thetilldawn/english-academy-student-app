import { z } from "zod";

import {
  studentDirectoryStatuses,
  studentDirectoryWrongFilters,
} from "@/features/students/public-contracts";
import {
  AssignmentDirectorySelectionError,
  listAssignmentDirectorySelection,
} from "@/features/assignments/server/queries/assignment-directory-selection-query";
import { getAdminContext } from "@/lib/auth/admin";
import { isSameOriginRequest, privateJsonError } from "@/lib/http";

const requestSchema = z.object({
  filters: z.object({
    classGroupId: z.union([z.literal(""), z.uuid()]),
    grade: z.string().max(40),
    query: z.string().max(80),
    school: z.string().max(120),
    status: z.enum(studentDirectoryStatuses),
    wordbook: z.string().max(160),
    wrong: z.enum(studentDirectoryWrongFilters),
  }),
  snapshotAt: z.iso.datetime({ offset: true }),
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
    return privateJsonError("학생 선택 조건을 확인해 주세요.", 400);
  }
  try {
    const selection = await listAssignmentDirectorySelection(
      parsed.data,
      admin,
    );
    return Response.json({ selection }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AssignmentDirectorySelectionError) {
      return privateJsonError(
        error.message,
        error.reason === "too_many" ? 409 : 503,
      );
    }
    console.error("[assignment-directory-selection] read failed", {
      message: error instanceof Error ? error.message : "unknown",
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return privateJsonError(
      "선택할 학생을 불러오지 못했습니다.",
      503,
    );
  }
}
