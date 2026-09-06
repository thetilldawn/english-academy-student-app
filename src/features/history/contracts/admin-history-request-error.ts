export type AdminHistoryFailureKind =
  | "unavailable"
  | "timeout"
  | "invalid-response"
  | "invalid-request"
  | "unauthenticated"
  | "forbidden";

export class AdminHistoryRequestError extends Error {
  constructor(readonly kind: AdminHistoryFailureKind) {
    // Diagnostic category only. Presentation owns the user-facing copy.
    super(`history_${kind}`);
    this.name = "AdminHistoryRequestError";
  }
}

export function historyFailureKind(error: unknown): AdminHistoryFailureKind {
  return error instanceof AdminHistoryRequestError ? error.kind : "unavailable";
}

export function isHistoryAccessFailure(kind: AdminHistoryFailureKind | null) {
  return kind === "unauthenticated" || kind === "forbidden";
}
