export class StudentDetailReadError extends Error {
  constructor(
    message: string,
    readonly kind: "read" | "contract" = "read",
  ) {
    super(message);
    this.name = "StudentDetailReadError";
  }
}
