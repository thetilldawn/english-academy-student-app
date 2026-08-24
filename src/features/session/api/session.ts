async function readError(response: Response): Promise<string | undefined> {
  try {
    const payload: unknown = await response.json();
    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
    ) {
      return payload.error;
    }
  } catch {
    // Empty and non-JSON responses do not replace the HTTP result.
  }
  return undefined;
}

async function login(
  url: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const error = await readError(response);
  return { error, ok: response.ok };
}

export function requestAdminLogin(
  input: { email: FormDataEntryValue | null; password: FormDataEntryValue | null },
  signal: AbortSignal,
) {
  return login("/api/admin/session", input, signal);
}

export function requestStudentLogin(code: string, signal: AbortSignal) {
  return login("/api/student/session", { code }, signal);
}

async function logout(url: string) {
  const response = await fetch(url, { method: "DELETE" });
  return response.ok;
}

export function requestAdminLogout() {
  return logout("/api/admin/session");
}

export function requestStudentLogout() {
  return logout("/api/student/session");
}
