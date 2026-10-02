import type { LocalQuizRequest } from "../contracts/local-quiz";
export class LocalQuizClientError extends Error {
  constructor(message: string, readonly status = 0, readonly code = "") { super(message); }
}
export async function requestLocalQuiz(command: LocalQuizRequest, signal?: AbortSignal): Promise<unknown> {
  try {
    const response = await fetch("/api/student/local-quiz", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify(command), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
    const data = await response.json();
    if (!response.ok) throw new LocalQuizClientError(typeof data.error === "string" ? data.error : "시험 정보를 확인하지 못했습니다.", response.status, data.code);
    return data;
  } catch (error) {
    if (error instanceof LocalQuizClientError || signal?.aborted) throw error;
    throw new LocalQuizClientError("연결을 확인한 뒤 다시 시도해 주세요. 저장한 답은 기기에 보관됩니다.");
  }
}
