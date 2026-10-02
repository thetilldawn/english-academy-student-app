import { z } from "zod";
import { wrongWordPageSchema, type WrongWordPageFilters } from "../contracts/wrong-word-page";
import { wrongWordFilterSearchParams, wrongWordFiltersSchema } from "../contracts/wrong-word-filters";
import type { ReadingCurriculumStage } from "@/lib/admin/reading-curriculum";
import { adminMistakePageSchema, mistakeFiltersSchema, queueMistakesSchema, type MistakeFilters, type MistakeTarget } from "../contracts/mistake-episode";

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (response.status === 401 || response.status === 403) {
    throw new WrongWordRequestError("관리자 로그인을 다시 확인해 주세요.", response.status);
  }
  let payload: T & { error?: string };
  try { payload = await response.json(); }
  catch { throw new WrongWordRequestError("요청을 처리하지 못했습니다. 다시 시도해 주세요.", response.status); }
  if (!response.ok) {
    throw new WrongWordRequestError(payload.error ?? "요청을 처리하지 못했습니다.", response.status);
  }
  return payload;
}
export class WrongWordRequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function loadStudentWrongWords(studentId: string, signal: AbortSignal, filters: WrongWordPageFilters, cursor?: string | null) {
  const input = wrongWordFiltersSchema.safeParse(filters);
  if (!input.success) throw new WrongWordRequestError("오답 조회 조건을 확인해 주세요. 검색어는 200자까지 입력할 수 있습니다.", 400);
  const query = wrongWordFilterSearchParams(input.data);
  if (cursor) query.set("cursor", cursor);
  const response = await requestJson<{ page?: unknown }>(
    `/api/admin/students/${studentId}/wrong-words?${query}`,
    { cache: "no-store", signal },
  );
  const parsed = wrongWordPageSchema.safeParse(response.page);
  if (!parsed.success) throw new WrongWordRequestError("오답 목록을 불러오지 못했습니다. 다시 시도해 주세요.", 502);
  return parsed.data;
}

export function queueStudentWrongWords(
  studentId: string,
  questionIds: readonly string[],
) {
  return requestJson<{ queueIds?: string[]; error?: string }>(
    `/api/admin/students/${studentId}/wrong-words`,
    jsonPost({ questionIds }),
  );
}

export async function loadStudentMistakes(studentId: string, signal: AbortSignal, filters: MistakeFilters, cursor?: string | null) {
  const input = mistakeFiltersSchema.safeParse(filters);
  if (!input.success) throw new WrongWordRequestError("오답 조회 조건을 확인해 주세요.", 400);
  const { view, sort, ...base } = input.data, params = wrongWordFilterSearchParams(base);
  params.set("view", view); params.set("sort", sort); if (cursor) params.set("cursor", cursor);
  const response = await requestJson<{ page?: unknown }>(`/api/admin/students/${studentId}/wrong-words?${params}`, { cache: "no-store", signal });
  const parsed = adminMistakePageSchema.safeParse(response.page);
  if (!parsed.success) throw new WrongWordRequestError("오답 목록을 불러오지 못했습니다. 다시 시도해 주세요.", 502);
  return parsed.data;
}
export async function queueStudentMistakes(studentId: string, targets: readonly MistakeTarget[]) {
  const payload = await requestJson<unknown>(`/api/admin/students/${studentId}/wrong-words`, jsonPost(queueMistakesSchema.parse({ targets })));
  const parsed = z.object({ queueIds: z.array(z.uuid()).length(targets.length) }).strict().safeParse(payload);
  if (!parsed.success || new Set(parsed.data.queueIds).size !== targets.length) throw new WrongWordRequestError("저장 결과를 확인하지 못했습니다. 목록을 다시 확인해 주세요.", 502);
  return parsed.data;
}

export function createStudentWorksheetRequest(
  studentId: string,
  input: {
    curriculumStage: ReadingCurriculumStage;
  } & ({ questionIds: readonly string[] } | { targets: readonly MistakeTarget[] }),
) {
  return requestJson<{
    request?: { itemCount: number; reused: boolean };
    sync?: {
      errorCode?: string;
      status: "not_configured" | "synced" | "unchanged" | "failed";
    };
    error?: string;
  }>(
    `/api/admin/students/${studentId}/worksheet-requests`,
    jsonPost(input),
  );
}

export function cancelStudentReviewDraft(studentId: string, draftId: string) {
  return requestJson<{
    error?: string;
    queueDisposition?: string;
    status?: string;
  }>(
    `/api/admin/students/${studentId}/review-assignment-drafts/${draftId}`,
    { method: "DELETE" },
  );
}
