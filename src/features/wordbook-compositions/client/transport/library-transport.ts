import { libraryCatalogSchema, libraryCommandResultSchema, type LibraryCommand } from "../../contracts/library";

export class LibraryRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const endpoint = "/api/admin/wordbook-library";
function failure(status: number, saving: boolean) {
  return new LibraryRequestError(status, [401, 403].includes(status) ? "관리자 로그인이 필요합니다."
    : status === 404 ? "템플릿을 찾을 수 없습니다. 목록을 다시 확인해 주세요."
    : status === 409 ? "자료가 변경되었습니다. 변경 내용을 다시 확인해 주세요."
    : status === 422 ? "이름과 선택한 범위를 확인해 주세요."
    : saving ? "저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인해 주세요."
    : "자료를 불러오지 못했습니다. 다시 시도해 주세요.");
}
export async function readLibrary(signal: AbortSignal) {
  const response = await fetch(endpoint, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), cache: "no-store" });
  if (!response.ok) throw failure(response.status, false);
  const parsed = libraryCatalogSchema.safeParse(await response.json());
  if (!parsed.success) throw failure(503, false);
  return parsed.data;
}
export async function sendLibraryCommand(command: LibraryCommand) {
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command), cache: "no-store", signal: AbortSignal.timeout(command.action === "materialize" ? 295000 : 30000) });
  if (!response.ok) throw failure(response.status, true);
  const parsed = libraryCommandResultSchema.safeParse(await response.json());
  if (!parsed.success) throw failure(503, true);
  if (command.action === "materialize" && (parsed.data.template.id !== command.templateId || parsed.data.createdBook?.versionId !== command.versionId || parsed.data.createdBook.contentHash !== command.contentHash)) throw failure(503, true);
  if (command.action !== "materialize" && parsed.data.createdBook) throw failure(503, true);
  return parsed.data;
}
