import { studentAppText } from "@/content/ko/student-app";

export class StudentDashboardRequestError extends Error {
  constructor(readonly status: number) {
    super(status === 401 || status === 403
      ? studentAppText.dashboard.history.authRequired
      : status === 409 ? studentAppText.dashboard.history.studentChanged
      : studentAppText.dashboard.history.loadError);
    this.name = "StudentDashboardRequestError";
  }
}
