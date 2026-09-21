import { getAdminContext } from "@/lib/auth/admin";
import { privateJsonError } from "@/lib/http";
import { saveLibraryTemplateV2, materializeLibraryComposition, LibraryCommandError, libraryJsonResponse } from "@/features/wordbook-compositions/public-server";

export const maxDuration = 300;
export async function POST(request: Request) {
  const admin = await getAdminContext();
  if (!admin) return privateJsonError("관리자 로그인이 필요합니다.", 401);
  if (request.headers.get("X-Wordbook-Viewer") !== admin.userId) return privateJsonError("관리자 로그인이 필요합니다.", 403);
  const input: unknown = await request.json().catch(() => null);
  try {
    const materialize = input && typeof input === "object" && "action" in input && input.action === "materialize";
    return libraryJsonResponse(await (materialize ? materializeLibraryComposition(input, admin, true) : saveLibraryTemplateV2(input, admin)));
  } catch (error) {
    const status = error instanceof LibraryCommandError ? error.status : 503;
    const response = privateJsonError(status === 403 ? "관리자 로그인이 필요합니다." : status === 404 ? "템플릿을 찾을 수 없습니다. 목록을 다시 확인해 주세요."
      : status === 409 ? "자료가 변경되었습니다. 변경 내용을 다시 확인해 주세요." : status === 422 ? "이름과 선택한 범위를 확인해 주세요."
      : "저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인해 주세요.", status);
    if (error instanceof LibraryCommandError && error.progressConfirmed) response.headers.set("X-Wordbook-Progress", "confirmed");
    return response;
  }
}
