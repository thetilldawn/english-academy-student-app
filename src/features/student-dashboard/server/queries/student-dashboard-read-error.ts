export class StudentDashboardReadError extends Error {
  constructor(
    message: string,
    readonly reason: "database" | "contract" = "database",
  ) {
    super(message);
    this.name = "StudentDashboardReadError";
  }
}

