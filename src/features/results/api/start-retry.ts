import { studentAppText } from "@/content/ko/student-app";

type RetryResponse = {
  retry?: { phase: "retry" };
  error?: string;
};

export async function requestAttemptRetry(attemptId: string) {
  const protocolResponse = await fetch(`/api/student/local-quiz-protocol/${attemptId}`, { cache: "no-store" });
  if (!protocolResponse.ok) throw new Error(studentAppText.actions.retryError);
  const protocol = await protocolResponse.json() as { local: boolean };
  if (protocol.local === true) return;
  if (protocol.local !== false) throw new Error(studentAppText.actions.retryError);
  const response = await fetch(`/api/student/attempts/${attemptId}/retry`, {
    method: "POST",
    headers: { "x-quiz-preparation": "1" },
  });
  const payload = (await response.json()) as RetryResponse;

  if (!response.ok || payload.retry?.phase !== "retry") {
    throw new Error(payload.error ?? studentAppText.actions.retryError);
  }
}
