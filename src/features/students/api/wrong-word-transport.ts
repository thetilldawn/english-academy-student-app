import type { StudentWrongWordHistory } from "@/lib/admin/wrong-word-history";
import type { ReadingCurriculumStage } from "@/lib/admin/reading-curriculum";

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "요청을 처리하지 못했습니다.");
  }
  return payload;
}
function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function loadStudentWrongWords(studentId: string, signal: AbortSignal) {
  return requestJson<{ history?: StudentWrongWordHistory; error?: string }>(
    `/api/admin/students/${studentId}/wrong-words`,
    { cache: "no-store", signal },
  );
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
