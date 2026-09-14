import { compositionCatalogSchema, createdCompositionSchema, type CreateCompositionInput } from "../../contracts/composition";

export class CompositionRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const endpoint = "/api/admin/wordbook-compositions";
function failure(status: number, saving: boolean) {
  return new CompositionRequestError(status, status === 401 || status === 403 ? "관리자 로그인이 필요합니다."
    : status === 409 ? "선택한 범위의 준비 상태가 바뀌었습니다. 목록을 다시 확인해 주세요."
    : status === 422 ? "단어장 이름과 담은 범위를 확인해 주세요."
    : saving ? "저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인해 주세요." : "범위를 불러오지 못했습니다.");
}
export async function readCompositionCatalog(signal: AbortSignal) {
  const response = await fetch(endpoint, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), cache: "no-store" });
  if (!response.ok) throw failure(response.status, false);
  const parsed = compositionCatalogSchema.safeParse(await response.json());
  if (!parsed.success) throw failure(503, false);
  return parsed.data.scopes;
}
export async function saveComposition(input: CreateCompositionInput) {
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), cache: "no-store", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw failure(response.status, true);
  const parsed = createdCompositionSchema.safeParse(await response.json());
  if (!parsed.success) throw failure(503, true);
  return parsed.data;
}
