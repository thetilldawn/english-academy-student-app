export class StudentDirectoryReadError extends Error {
  constructor(
    message: string,
    readonly reason: "query" | "contract" = "query",
  ) {
    super(message);
    this.name = "StudentDirectoryReadError";
  }
}
