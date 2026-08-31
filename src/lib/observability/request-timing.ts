export const APP_REQUEST_ID_HEADER = "x-app-request-id";
export const APP_REQUEST_DEADLINE_HEADER = "x-app-request-deadline-at";

const MAX_REQUEST_ID_LENGTH = 160;
const DEFAULT_SLOW_OPERATION_MS = 1_000;

type OperationOutcome = "cancelled" | "error" | "success" | "timeout";

function sanitizeIdentifier(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._:-]/g, "_")
    .slice(0, MAX_REQUEST_ID_LENGTH);
}

export function createRequestId(requestHeaders: Headers): string {
  const vercelRequestId = requestHeaders.get("x-vercel-id")?.trim();
  return vercelRequestId
    ? sanitizeIdentifier(vercelRequestId)
    : crypto.randomUUID();
}

export function readRequestId(requestHeaders: Headers): string | null {
  const value = requestHeaders.get(APP_REQUEST_ID_HEADER)?.trim();
  return value ? sanitizeIdentifier(value) : null;
}

export function readRequestDeadlineAt(
  requestHeaders: Headers,
): number | null {
  const value = requestHeaders.get(APP_REQUEST_DEADLINE_HEADER)?.trim();
  if (!value || !/^\d{10,16}$/.test(value)) return null;
  const deadlineAt = Number(value);
  return Number.isSafeInteger(deadlineAt) ? deadlineAt : null;
}

export function formatServerTiming(
  metric: string,
  durationMs: number,
): string {
  const safeMetric = metric.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return `${safeMetric};dur=${Math.max(0, durationMs).toFixed(1)}`;
}

export function appendServerTiming(
  responseHeaders: Headers,
  metric: string,
): void {
  const existing = responseHeaders.get("Server-Timing");
  responseHeaders.set(
    "Server-Timing",
    existing ? `${existing}, ${metric}` : metric,
  );
}

export function logServerOperationTiming(input: {
  durationMs: number;
  operation: string;
  outcome: OperationOutcome;
  requestId?: string | null;
  slowAfterMs?: number;
}): void {
  const slowAfterMs = input.slowAfterMs ?? DEFAULT_SLOW_OPERATION_MS;
  if (input.outcome === "success" && input.durationMs < slowAfterMs) return;

  console.warn(JSON.stringify({
    level: "warn",
    event: "server.operation_timing",
    requestId: input.requestId ?? null,
    operation: sanitizeIdentifier(input.operation),
    outcome: input.outcome,
    durationMs: Number(Math.max(0, input.durationMs).toFixed(1)),
  }));
}
