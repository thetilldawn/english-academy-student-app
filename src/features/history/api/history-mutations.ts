type ErrorResponse = {
  error?: string;
};

async function mutate(
  url: string,
  options: RequestInit,
  fallbackError: string,
) {
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
}

export function cancelStudentAssignment(
  assignmentId: string,
  studentId: string,
  fallbackError: string,
) {
  return mutate(
    `/api/admin/assignments/${assignmentId}/students/${studentId}`,
    { method: "DELETE" },
    fallbackError,
  );
}

export function hideAdminHistoryEntry(
  input: {
    assignmentId: string;
    studentId: string;
    attemptId: string | null;
  },
  fallbackError: string,
) {
  return mutate(
    "/api/admin/history",
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
    fallbackError,
  );
}
