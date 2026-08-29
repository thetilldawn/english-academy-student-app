import { z } from "zod";

import {
  studentHistoryPurposeFilters,
  studentHistorySectionFilters,
} from "@/features/students/contracts/student-detail-read-model";
import { StudentDetailReadError } from "@/features/students/server/queries/student-detail-read-error";
import {
  getStudentHistoryInitial,
  getStudentHistoryNextPage,
} from "@/features/students/server/queries/student-history-query";
import { StudentHistoryCursorError } from "@/features/students/server/student-history-cursor";
import { getAdminContext } from "@/lib/auth/admin";
import { isSameOriginRequest, privateJsonError } from "@/lib/http";

const filtersSchema = z.object({
  purpose: z.enum(studentHistoryPurposeFilters),
  section: z.enum(studentHistorySectionFilters),
  since: z.iso.datetime({ offset: true }).nullable(),
});

const requestSchema = z.discriminatedUnion("mode", [
  z.object({ filters: filtersSchema, mode: z.literal("initial") }),
  z.object({
    cursor: z.string().min(1).max(1800),
    filters: filtersSchema,
    mode: z.literal("page"),
  }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return privateJsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) {
    return privateJsonError("관리자 로그인이 필요합니다.", 401);
  }
  const parsedId = z.uuid().safeParse((await params).id);
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsedId.success || !parsed.success) {
    return privateJsonError("학생 내역 조건을 확인해 주세요.", 400);
  }
  try {
    const page = parsed.data.mode === "initial"
      ? await getStudentHistoryInitial({
          filters: parsed.data.filters,
          studentId: parsedId.data,
        }, admin)
      : await getStudentHistoryNextPage({
          cursor: parsed.data.cursor,
          filters: parsed.data.filters,
          studentId: parsedId.data,
        }, admin);
    return Response.json({ page }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof StudentHistoryCursorError) {
      return privateJsonError(error.message, 409);
    }
    console.error("[student-history-api] read failed", {
      kind: error instanceof StudentDetailReadError ? error.kind : "unknown",
      message: error instanceof Error ? error.message : "unknown",
    });
    return privateJsonError("학생 시험 내역을 불러오지 못했습니다.", 503);
  }
}
