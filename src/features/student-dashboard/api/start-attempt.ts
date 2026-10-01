type StartAttemptResponse = {
  attemptId?: string;
  error?: string;
};

export async function requestStudentAttempt(assignmentId: string) {
  const response = await fetch(
    `/api/student/assignments/${assignmentId}/attempts`,
    { method: "POST", headers: { "x-quiz-preparation": "1" } },
  );
  const payload = (await response.json()) as StartAttemptResponse;
  return { ok: response.ok, payload };
}
