import { mistakeStudyPageSchema, mistakeStudyWordSchema, notebookWordToken, mistakeFiltersSchema, wrongWordFilterSearchParams, type MistakeFilters } from "@/features/students/public-contracts";
import { awaitWithAbortSignal, createRequestDeadline, INTERACTIVE_READ_REQUEST_DEADLINE_MS } from "@/lib/network/request-policy";
export class NotebookRequestError extends Error {
  constructor(public readonly status: number) { super(status === 401 || status === 403 ? "다시 로그인해 주세요." : status === 409 ? "오답 목록이 바뀌어 최신 목록을 불러옵니다. 다시 선택해 주세요." : "단어를 불러오지 못했습니다. 다시 시도해 주세요."); }
}
export async function loadNotebookWord(wordKey:string,view: "current"|"history",upperVersion:string,signal:AbortSignal,identity:string) {
  const params=new URLSearchParams({view});if(view==="history")params.set("upperVersion",upperVersion);
  const deadline=createRequestDeadline(INTERACTIVE_READ_REQUEST_DEADLINE_MS,signal);
  try {
    const response=await awaitWithAbortSignal(fetch(`/api/student/notebook/${notebookWordToken(wordKey)}?${params}`,{
      cache:"no-store",signal:deadline.signal,headers:{"x-student-notebook-identity":identity},
    }),deadline.signal);
    if(!response.ok){void response.body?.cancel().catch(()=>undefined);throw new NotebookRequestError(response.status);}
    const payload=await awaitWithAbortSignal(response.json(),deadline.signal);
    if(payload?.identity!==identity)throw new NotebookRequestError(401);
    const parsed=mistakeStudyWordSchema.safeParse(payload?.word);
    if(!parsed.success||parsed.data.key!==wordKey||view==="history"&&parsed.data.meanings.some(m=>m.stateVersion!==upperVersion))throw new NotebookRequestError(502);
    return parsed.data;
  }catch(error){if(error instanceof NotebookRequestError||signal.aborted)throw error;throw new NotebookRequestError(0);}
  finally{deadline.dispose();}
}
export async function loadNotebook(filters: MistakeFilters, cursor: string | null, signal: AbortSignal, identity: string) {
  const input = mistakeFiltersSchema.parse(filters);
  const { view, sort, ...base } = input;
  const params = wrongWordFilterSearchParams(base);
  params.set("sort", sort);
  params.set("view", view);
  if (cursor) params.set("cursor", cursor);
  const deadline = createRequestDeadline(INTERACTIVE_READ_REQUEST_DEADLINE_MS, signal);
  try {
    const response = await awaitWithAbortSignal(fetch(`/api/student/notebook?${params}`, { cache: "no-store", signal: deadline.signal, headers: { "x-student-notebook-identity": identity } }), deadline.signal);
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new NotebookRequestError(response.status); }
    const payload = await awaitWithAbortSignal(response.json(), deadline.signal);
    if (payload?.identity !== identity) throw new NotebookRequestError(401);
    const parsed = mistakeStudyPageSchema.safeParse(payload?.page);
    if (!parsed.success || (!cursor && (parsed.data.totalCount === null || parsed.data.summary === null || parsed.data.datasetOptions === null))) throw new NotebookRequestError(502);
    return parsed.data;
  } catch (error) {
    if (error instanceof NotebookRequestError || signal.aborted) throw error;
    throw new NotebookRequestError(0);
  } finally { deadline.dispose(); }
}
