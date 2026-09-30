import { notebookStudyPageSchema, notebookFiltersSchema, wrongWordFilterSearchParams, type NotebookFilters } from "@/features/students/public-contracts";
import { awaitWithAbortSignal, createRequestDeadline, INTERACTIVE_READ_REQUEST_DEADLINE_MS } from "@/lib/network/request-policy";
export class NotebookRequestError extends Error {
  constructor(public readonly status: number) { super(status === 401 || status === 403 ? "다시 로그인해 주세요." : "단어를 불러오지 못했습니다. 다시 시도해 주세요."); }
}
export async function loadNotebook(filters: NotebookFilters, cursor: string | null, signal: AbortSignal) {
  const input = notebookFiltersSchema.parse(filters);
  const { sort, ...base } = input;
  const params = wrongWordFilterSearchParams(base);
  params.set("sort", sort);
  if (cursor) params.set("cursor", cursor);
  const deadline = createRequestDeadline(INTERACTIVE_READ_REQUEST_DEADLINE_MS, signal);
  try {
    const response = await awaitWithAbortSignal(fetch(`/api/student/notebook?${params}`, { cache: "no-store", signal: deadline.signal }), deadline.signal);
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new NotebookRequestError(response.status); }
    const payload = await awaitWithAbortSignal(response.json(), deadline.signal);
    const parsed = notebookStudyPageSchema.safeParse(payload?.page);
    if (!parsed.success || (!cursor && (parsed.data.totalCount === null || parsed.data.summary === null || parsed.data.datasetOptions === null))) throw new NotebookRequestError(502);
    return parsed.data;
  } catch (error) {
    if (error instanceof NotebookRequestError || signal.aborted) throw error;
    throw new NotebookRequestError(0);
  } finally { deadline.dispose(); }
}
