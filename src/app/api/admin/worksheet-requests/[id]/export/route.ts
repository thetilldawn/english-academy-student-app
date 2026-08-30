import { z } from "zod";

import { getAdminContext } from "@/lib/auth/admin";
import { jsonError } from "@/lib/http";
import {
  exportWrongWordWorksheetRequest,
  wrongWordWorksheetFilename,
  WrongWordWorksheetError,
} from "@/lib/services/wrong-word-worksheet-service";

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
    return jsonError("해석 시험지 요청을 확인해 주세요.", 400);
  }

  try {
    const worksheet = await exportWrongWordWorksheetRequest(id, admin);
    return new Response(`${JSON.stringify(worksheet, null, 2)}\n`, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${wrongWordWorksheetFilename(worksheet)}"`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof WrongWordWorksheetError) {
      if (error.reason === "forbidden") {
        return jsonError("관리자 권한을 다시 확인해 주세요.", 403);
      }
      if (error.reason === "not_found") {
        return jsonError("해석 시험지 요청을 찾지 못했습니다.", 404);
      }
    }
    return jsonError(
      "익명 기준본을 내보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }
}
