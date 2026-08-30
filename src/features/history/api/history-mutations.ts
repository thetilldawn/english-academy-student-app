import type {
  AdminHistoryCancellationResponse,
} from "../contracts/admin-history-mutation";

type ErrorResponse = {
  error?: string;
};

async function mutate<Result>(
  url: string,
  options: RequestInit,
  fallbackError: string,
): Promise<Result> {
  const response = await fetch(url, options);
  let payload: ErrorResponse = {};
  try {
    payload = (await response.json()) as ErrorResponse;
  } catch {
    // Empty and non-JSON failures use the caller's fallback message.
  }
  if (!response.ok) {
    throw new Error(payload.error ?? fallbackError);
  }
  return payload as Result;
}

export function cancelStudentAssignment(
  assignmentId: string,
  studentId: string,
  fallbackError: string,
): Promise<AdminHistoryCancellationResponse> {
  return mutate<AdminHistoryCancellationResponse>(
    `/api/admin/assignments/${assignmentId}/students/${studentId}`,
    { method: "DELETE" },
    fallbackError,
  );
}
