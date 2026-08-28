import type { AssignmentTransportResponse } from "../transport/assignment-transport";

export type AssignmentOperationRecovery =
  | "none"
  | "refresh_preview"
  | "refresh_summary_and_preview"
  | "reload_source"
  | "reauthenticate";

export type AssignmentOperationError = {
  kind:
    | "aborted"
    | "busy"
    | "unauthorized"
    | "forbidden"
    | "not_found"
    | "conflict"
    | "invalid_request"
    | "temporary"
    | "protocol"
    | "network"
    | "unknown";
  code?: string;
  fieldPath?: string;
  message: string;
  recovery: AssignmentOperationRecovery;
  retryable: boolean;
  status?: number;
};

type ErrorPayload = {
  code?: string;
  error?: string;
  fieldPath?: string;
};

function errorPayload(data: unknown): ErrorPayload {
  if (!data || typeof data !== "object") return {};
  const value = data as Record<string, unknown>;
  return {
    code: typeof value.code === "string" ? value.code : undefined,
    error:
      typeof value.error === "string" && value.error.trim()
        ? value.error
        : undefined,
    fieldPath:
      typeof value.fieldPath === "string" ? value.fieldPath : undefined,
  };
}

export function isAbortFailure(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError",
  );
}

export function assignmentFailureFromResponse(
  response: AssignmentTransportResponse,
  fallback: string,
  recovery?: AssignmentOperationRecovery,
): AssignmentOperationError {
  const payload = errorPayload(response.data);
  const common = {
    code: payload.code,
    fieldPath: payload.fieldPath,
    message: payload.error ?? fallback,
    status: response.status,
  };
  if (response.status === 401) {
    return {
      ...common,
      kind: "unauthorized",
      recovery: recovery ?? "reauthenticate",
      retryable: false,
    };
  }
  if (response.status === 403) {
    return {
      ...common,
      kind: "forbidden",
      recovery: recovery ?? "none",
      retryable: false,
    };
  }
  if (response.status === 404) {
    return {
      ...common,
      kind: "not_found",
      recovery: recovery ?? "reload_source",
      retryable: false,
    };
  }
  if (response.status === 409) {
    return {
      ...common,
      kind: "conflict",
      recovery: recovery ?? "refresh_preview",
      retryable: true,
    };
  }
  if (response.status === 400 || response.status === 422) {
    return {
      ...common,
      kind: "invalid_request",
      recovery: recovery ?? "none",
      retryable: false,
    };
  }
  if (response.status >= 500) {
    return {
      ...common,
      kind: "temporary",
      recovery: recovery ?? "none",
      retryable: true,
    };
  }
  return {
    ...common,
    kind: "unknown",
    recovery: recovery ?? "none",
    retryable: false,
  };
}

export function assignmentFailureFromCause(
  error: unknown,
  fallback: string,
): AssignmentOperationError {
  if (isAbortFailure(error)) {
    return {
      kind: "aborted",
      message: fallback,
      recovery: "none",
      retryable: true,
    };
  }
  return {
    kind: "network",
    message: fallback,
    recovery: "none",
    retryable: true,
  };
}

export function assignmentProtocolFailure(
  fallback: string,
): AssignmentOperationError {
  return {
    kind: "protocol",
    message: fallback,
    recovery: "none",
    retryable: true,
  };
}

export function assignmentBusyFailure(
  message: string,
): AssignmentOperationError {
  return {
    kind: "busy",
    message,
    recovery: "none",
    retryable: true,
  };
}
