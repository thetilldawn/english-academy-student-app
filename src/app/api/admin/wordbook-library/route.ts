import { getAdminContext } from "@/lib/auth/admin";
import { privateJsonError } from "@/lib/http";
import { getLibraryCatalog, LibraryCatalogError, saveLibraryTemplate, materializeLibraryComposition, LibraryCommandError, libraryJsonResponse } from "@/features/wordbook-compositions/public-server";

export const maxDuration = 300;

export async function GET() {
  const admin = await getAdminContext();
  if (!admin) return privateJsonError("관리자 로그인이 필요합니다.", 401);
  try { return libraryJsonResponse(await getLibraryCatalog(admin)); }
  catch (error) { return privateJsonError("자료를 불러오지 못했습니다. 다시 시도해 주세요.", error instanceof LibraryCatalogError ? error.status : 503); }
}

export async function POST(request: Request) {
  const admin = await getAdminContext();
  if (!admin) return privateJsonError("관리자 로그인이 필요합니다.", 401);
  const expectedViewer = request.headers.get("X-Wordbook-Viewer");
  if (expectedViewer !== null && expectedViewer !== admin.userId) return privateJsonError("관리자 로그인이 필요합니다.", 403);
  const input: unknown = await request.json().catch(() => null);
  try {
    const materialize = input && typeof input === "object" && "action" in input && input.action === "materialize";
    return libraryJsonResponse(await (materialize ? materializeLibraryComposition(input, admin) : saveLibraryTemplate(input, admin)));
  }
  catch (error) {
    const status = error instanceof LibraryCommandError ? error.status : 503;
    const response = privateJsonError(status === 403 ? "관리자 로그인이 필요합니다." : status === 404 ? "템플릿을 찾을 수 없습니다. 목록을 다시 확인해 주세요."
      : status === 409 ? "자료가 변경되었습니다. 변경 내용을 다시 확인해 주세요."
      : status === 422 ? "이름과 선택한 범위를 확인해 주세요."
      : "저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인해 주세요.", status);
    if (error instanceof LibraryCommandError && error.progressConfirmed) response.headers.set("X-Wordbook-Progress", "confirmed");
    return response;
  }
}
