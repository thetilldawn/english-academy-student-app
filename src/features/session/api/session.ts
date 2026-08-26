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

export type StudentSessionRenewalRequestResult =
  | { status: "ok"; nextCheckInMilliseconds: number }
  | { status: "invalid" | "retry" | "aborted" };

export async function requestStudentSessionRenewal(
  signal: AbortSignal,
): Promise<StudentSessionRenewalRequestResult> {
  try {
    const response = await fetch("/api/student/session", {
      method: "PATCH",
      credentials: "same-origin",
      signal,
    });
    if (response.status === 401) return { status: "invalid" };
    if (!response.ok) return { status: "retry" };
    const payload: unknown = await response.json();
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("nextCheckInMilliseconds" in payload) ||
      typeof payload.nextCheckInMilliseconds !== "number" ||
      !Number.isFinite(payload.nextCheckInMilliseconds)
    ) {
      return { status: "retry" };
    }
    return {
      status: "ok",
      nextCheckInMilliseconds: Math.max(
        0,
        payload.nextCheckInMilliseconds,
      ),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { status: "aborted" };
    }
    return { status: "retry" };
  }
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
