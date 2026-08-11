import { studentAppText } from "@/content/ko/student-app";

type RetryResponse = {
  retry?: { phase: "retry" };
  error?: string;
};

export async function requestAttemptRetry(attemptId: string) {
  const response = await fetch(`/api/student/attempts/${attemptId}/retry`, {
    method: "POST",
  });
  const payload = (await response.json()) as RetryResponse;

  if (!response.ok || payload.retry?.phase !== "retry") {
    throw new Error(payload.error ?? studentAppText.actions.retryError);
  }
}
