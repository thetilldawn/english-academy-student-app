import { getAdminContext } from "@/lib/auth/admin";
import { isSameOriginRequest, jsonError, parseJson } from "@/lib/http";
import {
  createVocabTimeTemplate,
  VocabTimeTemplateError,
} from "@/lib/services/vocab-time-template-service";
import { createVocabTimeTemplateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 로그인이 필요합니다.", 401);
  }
  const input = await parseJson(request, createVocabTimeTemplateSchema);
  if (!input) {
    return jsonError("시간 템플릿 내용을 확인해 주세요.", 400);
  }
  try {
    const template = await createVocabTimeTemplate(input, admin);
    return Response.json(
      { template },
      {
        status: 201,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    if (error instanceof VocabTimeTemplateError) {
      return jsonError(error.message, error.reason === "duplicate" ? 409 : 503);
    }
    return jsonError("시간 템플릿을 저장하지 못했습니다.", 503);
  }
}
