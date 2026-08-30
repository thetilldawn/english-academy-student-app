import { getAdminContext } from "@/lib/auth/admin";
import { isSameOriginRequest, privateJsonError } from "@/lib/http";
import { revalidateSharedVocabMaterialCache } from "@/lib/services/shared-vocab-material-cache";

const privateNoStore = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return privateJsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) {
    return privateJsonError("관리자 로그인이 필요합니다.", 401);
  }

  revalidateSharedVocabMaterialCache();
  return Response.json({ ok: true }, { headers: privateNoStore });
}
