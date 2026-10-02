import { libraryCatalogSchema, libraryCommandResultSchema, type LibraryCommand } from "../../contracts/library";
import { compositionProgressSchema } from "../../contracts/library-materialization";
import { type LibraryQuery } from "../../contracts/library-query";
import { libraryCommandV2ResultSchema } from "../../contracts/library-command-v2";
import { classifiedQueryResultSchema, libraryCommandV3ResultSchema, type ClassifiedQueryResultOf, type LibraryWriteCommand } from "../../contracts/library-v3";
import { adminLearningText } from "@/content/ko/admin-learning";

export class LibraryRequestError extends Error {
  constructor(readonly status: number, message: string, readonly progressConfirmed = false) { super(message); }
}
const endpoint = "/api/admin/wordbook-library";
function failure(status: number, saving: boolean, progressConfirmed = false, sourceUnavailable = false) {
  return new LibraryRequestError(status, [401, 403].includes(status) ? "관리자 로그인이 필요합니다."
    : status === 409 && sourceUnavailable ? adminLearningText.wordbookLibrary.sourceUnavailable
    : status === 404 ? "템플릿을 찾을 수 없습니다. 목록을 다시 확인해 주세요."
    : status === 409 ? "자료가 변경되었습니다. 변경 내용을 다시 확인해 주세요."
    : status === 422 ? "이름과 선택한 범위를 확인해 주세요."
    : saving ? "저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인해 주세요."
    : "자료를 불러오지 못했습니다. 다시 시도해 주세요.", progressConfirmed);
}
export async function readLibrary(signal: AbortSignal) {
  const response = await fetch(endpoint, { signal: AbortSignal.any([signal, AbortSignal.timeout(65000)]), cache: "no-store" });
  if (!response.ok) throw failure(response.status, false);
  const parsed = libraryCatalogSchema.safeParse(await response.json());
  if (!parsed.success) throw failure(503, false);
  return parsed.data;
}
export async function sendLibraryCommand(command: LibraryCommand, viewerId: string) {
  let datasetId: string | undefined, previousProgress: string | undefined;
  for (let attempt = 0; attempt < 160; attempt++) {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Wordbook-Viewer": viewerId },
      body: JSON.stringify(command), cache: "no-store", signal: AbortSignal.timeout(command.action === "materialize" ? 295000 : 65000) });
    if (!response.ok) throw failure(response.status, true, Boolean(previousProgress) || response.headers.get("X-Wordbook-Progress") === "confirmed", response.headers.get("X-Wordbook-Source") === "unavailable");
    const body: unknown = await response.json();
    const progress = compositionProgressSchema.safeParse(body);
    if (progress.success) {
      const p = progress.data, signature = JSON.stringify(p);
      if (command.action !== "materialize" || p.requestId !== command.requestId || p.templateId !== command.templateId ||
        p.versionId !== command.versionId || p.contentHash !== command.contentHash || (datasetId && p.datasetId !== datasetId) ||
        signature === previousProgress) throw failure(503, true);
      datasetId = p.datasetId; previousProgress = signature;
      continue;
    }
    const parsed = libraryCommandResultSchema.safeParse(body);
    if (!parsed.success) throw failure(503, true);
    if (command.action === "materialize" && (parsed.data.template.id !== command.templateId || parsed.data.createdBook?.versionId !== command.versionId || parsed.data.createdBook.contentHash !== command.contentHash || (datasetId && parsed.data.createdBook.dataset.id !== datasetId))) throw failure(503, true);
    if (command.action !== "materialize" && parsed.data.createdBook) throw failure(503, true);
    return parsed.data;
  }
  throw failure(503, true);
}

export async function readLibraryPage<K extends LibraryQuery["kind"]>(query: Extract<LibraryQuery, { kind: K }>, signal: AbortSignal, viewerId?: string) {
  const response = await fetch(`${endpoint}/query`, { method: "POST", headers: { "Content-Type": "application/json", "X-Wordbook-Contract": "3", ...(viewerId ? { "X-Wordbook-Viewer": viewerId } : {}) },
    body: JSON.stringify(query), signal: AbortSignal.any([signal, AbortSignal.timeout(65000)]), cache: "no-store" });
  if (!response.ok) throw failure(response.status, false);
  const parsed = classifiedQueryResultSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.kind !== query.kind) throw failure(503, false);
  if (viewerId && parsed.data.viewerId !== viewerId) throw failure(403, false);
  return parsed.data as ClassifiedQueryResultOf<K>;
}

export async function sendLibraryCommandV2(command: LibraryWriteCommand, viewerId: string) {
  let datasetId: string | undefined, previousProgress: string | undefined;
  for (let attempt = 0; attempt < 160; attempt++) {
    const response = await fetch(`${endpoint}/commands`, { method: "POST", headers: { "Content-Type": "application/json", "X-Wordbook-Viewer": viewerId },
      body: JSON.stringify(command), cache: "no-store", signal: AbortSignal.timeout(command.action === "materialize" ? 295000 : 65000) });
    if (!response.ok) throw failure(response.status, true, Boolean(previousProgress) || response.headers.get("X-Wordbook-Progress") === "confirmed", response.headers.get("X-Wordbook-Source") === "unavailable");
    const body: unknown = await response.json();
    const progress = compositionProgressSchema.safeParse(body);
    if (progress.success) {
      const p = progress.data, signature = JSON.stringify(p);
      if (command.action !== "materialize" || p.requestId !== command.requestId || p.templateId !== command.templateId || p.versionId !== command.versionId || p.contentHash !== command.contentHash ||
        (datasetId && datasetId !== p.datasetId) || signature === previousProgress) throw failure(503, true);
      datasetId = p.datasetId; previousProgress = signature; continue;
    }
    const parsed = ("protocolVersion" in command ? libraryCommandV3ResultSchema : libraryCommandV2ResultSchema).safeParse(body);
    if (!parsed.success) throw failure(503, true);
    if (command.action === "delete") {
      if (!("deleted" in parsed.data) || parsed.data.deleted.templateId !== command.templateId || parsed.data.deleted.revision !== command.expectedRevision + 1) throw failure(503, true);
    } else {
      if (!("template" in parsed.data) || ("templateId" in command && parsed.data.template.id !== command.templateId)) throw failure(503, true);
      if (command.action === "materialize" && (parsed.data.createdBook?.versionId !== command.versionId || parsed.data.createdBook.contentHash !== command.contentHash ||
        (datasetId && parsed.data.createdBook.dataset.id !== datasetId))) throw failure(503, true);
      if (command.action !== "materialize" && parsed.data.createdBook) throw failure(503, true);
    }
    return parsed.data;
  }
  throw failure(503, true);
}
