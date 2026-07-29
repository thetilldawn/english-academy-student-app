import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { jsonError, isSameOriginRequest, parseJson } from "@/lib/http";
import {
  getStudentWrongWordHistory,
  queueStudentWrongWords,
  WrongWordQueueError,
} from "@/lib/services/wrong-word-service";
import { queueWrongWordsSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return jsonError("학생 정보를 확인해 주세요.", 400);
  }

  try {
    const history = await getStudentWrongWordHistory(id, admin);
    if (!history) {
      return jsonError("학생을 찾지 못했습니다.", 404);
    }
    return Response.json(
      { history },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch {
    return jsonError("오답 단어 이력을 불러오지 못했습니다.", 500);
  }
}

export async function POST(
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
    parseJson(request, queueWrongWordsSchema),
  ]);
  if (!z.uuid().safeParse(id).success || !input) {
    return jsonError("학생과 선택한 오답 단어를 확인해 주세요.", 400);
  }

  try {
    const queueIds = await queueStudentWrongWords(
      id,
      input.questionIds,
      admin,
    );
    return Response.json({ queueIds });
  } catch (error) {
    if (
      error instanceof WrongWordQueueError &&
      error.reason === "forbidden"
    ) {
      return jsonError("관리자 권한을 다시 확인해 주세요.", 403);
    }
    if (
      error instanceof WrongWordQueueError &&
      error.reason === "database"
    ) {
      return jsonError(
        "오답 복습 대기열을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        503,
      );
    }
    return jsonError(
      "완료된 시험의 오답인지 확인한 뒤 다시 시도해 주세요.",
      409,
    );
  }
}
