import { getAdminContext } from "@/lib/auth/admin";
import { privateJsonError } from "@/lib/http";
import { queryLibrary, LibraryCommandError, libraryJsonResponse } from "@/features/wordbook-compositions/public-server";

export const maxDuration = 60;
export async function POST(request: Request) {
  const admin = await getAdminContext();
  if (!admin) return privateJsonError("관리자 로그인이 필요합니다.", 401);
  const viewer = request.headers.get("X-Wordbook-Viewer");
  if (viewer !== null && viewer !== admin.userId) return privateJsonError("관리자 로그인이 필요합니다.", 403);
  try { return libraryJsonResponse(await queryLibrary(await request.json().catch(() => null), admin)); }
  catch (error) {
    const status = error instanceof LibraryCommandError ? error.status : 503;
    return privateJsonError(status === 403 ? "관리자 로그인이 필요합니다." : status === 409 ? "자료가 변경되었습니다. 범위를 다시 확인해 주세요."
      : status === 404 ? "템플릿을 찾을 수 없습니다. 목록을 다시 확인해 주세요." : status === 422 ? "입력한 조건과 범위를 확인해 주세요." : "자료를 불러오지 못했습니다. 다시 시도해 주세요.", status);
  }
}
