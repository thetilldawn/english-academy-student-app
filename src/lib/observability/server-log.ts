import { getErrorReference } from "@/lib/observability/error-reference";

const MAX_MESSAGE_LENGTH = 1_000;
const MAX_STACK_LENGTH = 3_000;

type UnknownRecord = Record<string, unknown>;

export type ServerErrorEventInput = {
  event: string;
  error: unknown;
  operation?: string;
  code?: string;
  errorId?: string | null;
  requestId?: string | null;
  route?: string;
  method?: string;
  context?: Record<string, string | undefined>;
};

export class ServerOperationError extends Error {
  readonly operation: string;
  readonly code: string;

  constructor(
    message: string,
    options: {
      operation: string;
      code: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "ServerOperationError";
    this.operation = options.operation;
    this.code = options.code;
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object"
    ? (value as UnknownRecord)
    : null;
}

function truncate(value: string, limit: number): string {
  return value.length <= limit
    ? value
    : `${value.slice(0, limit)}...[truncated]`;
}

export function redactLogText(
  value: unknown,
  options: { strong?: boolean; limit?: number } = {},
): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  let redacted = value
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[redacted-email]",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[redacted-uuid]",
    )
    .replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, "[redacted-code]")
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g, "[redacted-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, "Bearer [redacted]")
    .replace(
      /Key\s*\(([^)]*)\)\s*=\s*\(([^)]*)\)/gi,
      "Key ($1)=([redacted])",
    );

  if (options.strong) {
    redacted = redacted.replace(
      /([:=]\s*)(["'])([^"']+)\2/g,
      "$1$2[redacted]$2",
    );
  }

  return truncate(
    redacted,
    options.limit ?? MAX_MESSAGE_LENGTH,
  );
}

function readString(
  record: UnknownRecord | null,
  key: string,
): string | null {
  return redactLogText(record?.[key]);
}

function findSupabaseError(error: unknown): UnknownRecord | null {
  let current = asRecord(error);

  for (let depth = 0; current && depth < 5; depth += 1) {
    const hasSupabaseShape =
      typeof current.message === "string" &&
      typeof current.code === "string" &&
      ("details" in current || "hint" in current);

    if (hasSupabaseShape) {
      return current;
    }

    current = asRecord(current.cause);
  }

  return null;
}

function cleanIdentifier(
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value) {
    return fallback;
  }

  const cleaned = value.replace(/[^A-Za-z0-9._:/-]/g, "_");
  return truncate(cleaned, 180);
}

export function buildServerErrorEvent(input: ServerErrorEventInput) {
  const errorRecord = asRecord(input.error);
  const supabaseError = findSupabaseError(input.error);
  const isOperationError =
    errorRecord?.name === "ServerOperationError";
  const errorId =
    input.errorId ??
    getErrorReference(input.error) ??
    null;
  const operation =
    input.operation ??
    readString(errorRecord, "operation") ??
    "request.unknown";
  const code =
    input.code ??
    readString(errorRecord, "code") ??
    "UNHANDLED_REQUEST_ERROR";
  const stackWithoutMessage =
    typeof errorRecord?.stack === "string"
      ? errorRecord.stack.split(/\r?\n/).slice(1).join("\n")
      : null;
  const stack = redactLogText(stackWithoutMessage, {
    limit: MAX_STACK_LENGTH,
  });

  return {
    level: "error",
    event: cleanIdentifier(input.event, "operation.failed"),
    errorId: errorId
      ? cleanIdentifier(errorId, "unknown")
      : null,
    requestId: input.requestId
      ? cleanIdentifier(input.requestId, "unknown")
      : null,
    operation: cleanIdentifier(operation, "request.unknown"),
    code: cleanIdentifier(code, "UNHANDLED_REQUEST_ERROR"),
    route: input.route
      ? cleanIdentifier(input.route, "unknown")
      : null,
    method: input.method
      ? cleanIdentifier(input.method.toUpperCase(), "UNKNOWN")
      : null,
    context: input.context ?? null,
    error: {
      name: readString(errorRecord, "name") ?? "UnknownError",
      message: isOperationError
        ? (
            readString(errorRecord, "message") ??
            "Server operation failed"
          )
        : "Unhandled server error",
      stack,
    },
    supabase: supabaseError
      ? {
          code: readString(supabaseError, "code"),
          message: readString(supabaseError, "message"),
          details: redactLogText(supabaseError.details, {
            strong: true,
          }),
          hint: redactLogText(supabaseError.hint, {
            strong: true,
          }),
        }
      : null,
  };
}

export function logServerError(input: ServerErrorEventInput): void {
  console.error(JSON.stringify(buildServerErrorEvent(input)));
}
