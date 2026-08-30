import "server-only";

export class AdminHistoryReadError extends Error {
  constructor(
    message: string,
    readonly reason: "contract" | "database" | "input" = "database",
  ) {
    super(message);
    this.name = "AdminHistoryReadError";
  }
}
