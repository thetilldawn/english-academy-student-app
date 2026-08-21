import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { jsonError } from "@/lib/http";
import { listStudentVocabAssignmentQueuePage } from "@/lib/services/vocab-assignment-queue-service";

export const dynamic = "force-dynamic";

const cursorSchema = z
  .object({
    beforeSeriesId: z.uuid().optional(),
    beforeUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine(
    (value) => Boolean(value.beforeSeriesId) === Boolean(value.beforeUpdatedAt),
    { message: "incomplete cursor" },
  );

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await getAdminContext())) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return jsonError("학생 정보를 확인해 주세요.", 400);
  }

  const url = new URL(request.url);
  const cursor = cursorSchema.safeParse({
    beforeSeriesId: url.searchParams.get("beforeSeriesId") ?? undefined,
    beforeUpdatedAt: url.searchParams.get("beforeUpdatedAt") ?? undefined,
  });
  if (!cursor.success) {
    return jsonError("이어 배정 이력 위치를 확인해 주세요.", 400);
  }

  try {
    const page = await listStudentVocabAssignmentQueuePage({
      before:
        cursor.data.beforeSeriesId && cursor.data.beforeUpdatedAt
          ? {
              seriesId: cursor.data.beforeSeriesId,
              updatedAt: cursor.data.beforeUpdatedAt,
            }
          : undefined,
      studentId: id,
    });
    return Response.json(page, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return jsonError("이어 배정 이력을 불러오지 못했습니다.", 500);
  }
}
