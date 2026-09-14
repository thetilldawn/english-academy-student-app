import { getAdminContext } from "@/lib/auth/admin";
import { privateJsonError } from "@/lib/http";
import { getCompositionCatalog, createComposition, CompositionSaveError, CompositionCatalogError } from "@/features/wordbook-compositions/public-server";

export async function GET() {
  const admin = await getAdminContext();
  if (!admin) return privateJsonError("관리자 로그인이 필요합니다.", 401);
  try { return Response.json(await getCompositionCatalog(admin), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return privateJsonError("범위를 불러오지 못했습니다.", error instanceof CompositionCatalogError ? error.status : 503); }
}
export async function POST(request: Request) {
  const admin = await getAdminContext();
  if (!admin) return privateJsonError("관리자 로그인이 필요합니다.", 401);
  const input: unknown = await request.json().catch(() => null);
  try { return Response.json(await createComposition(input, admin), { status: 201, headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) {
    const status = error instanceof CompositionSaveError ? error.status : 503;
    return privateJsonError(status === 403 ? "관리자 로그인이 필요합니다." : status === 409 ? "선택한 범위의 준비 상태가 바뀌었습니다. 목록을 다시 확인해 주세요."
      : status === 422 ? "단어장 이름과 담은 범위를 확인해 주세요." : "저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인해 주세요.", status);
  }
}
