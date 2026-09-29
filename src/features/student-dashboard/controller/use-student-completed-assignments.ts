"use client";
import type { StudentDashboardCompletedPage } from "../contracts/student-dashboard-read-model";
import { useStudentAssignmentPage } from "./use-student-assignment-page";
export function useStudentCompletedAssignments(initialPage: StudentDashboardCompletedPage) {
  return useStudentAssignmentPage(initialPage);
}
