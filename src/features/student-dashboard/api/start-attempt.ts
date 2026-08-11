type StartAttemptResponse = {
  attemptId?: string;
  error?: string;
};

export async function requestStudentAttempt(assignmentId: string) {
  const response = await fetch(
    `/api/student/assignments/${assignmentId}/attempts`,
    { method: "POST" },
  );
  const payload = (await response.json()) as StartAttemptResponse;
  return { ok: response.ok, payload };
}
