import { wrongWordPageSchema, type WrongWordPageFilters } from "../contracts/wrong-word-page";
import type { ReadingCurriculumStage } from "@/lib/admin/reading-curriculum";

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
  const query = new URLSearchParams({ datasetId: filters.datasetId, level: filters.level, query: filters.query });
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

export function createStudentWorksheetRequest(
  studentId: string,
  input: {
    curriculumStage: ReadingCurriculumStage;
    questionIds: readonly string[];
  },
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
