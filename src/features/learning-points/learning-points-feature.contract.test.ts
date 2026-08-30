import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("learning point screen wiring", () => {
  it("loads the student dashboard balance beside assignments", () => {
    const content = source(
      "src/features/student-dashboard/server/components/student-dashboard-content.tsx",
    );
    expect(content).toContain("Promise.all([");
    expect(content).toContain("getStudentDashboardInitial(student)");
    expect(content).toContain("getStudentPointBalance(student.studentId)");
    expect(content).toContain("currentPoints={currentPoints}");
  });

  it("loads an owned attempt's questions and point summary together", () => {
    const query = source("src/lib/services/quiz/attempt-result-query.ts");
    expect(query).toContain(".eq(\"student_id\", studentId)");
    expect(query).toContain("const [questions, pointSummary] = await Promise.all([");
    expect(query).toContain("getAttemptQuestionResults(attemptId)");
    expect(query).toContain(
      "getStudentAttemptPointSummary(studentId, attemptId)",
    );
    expect(query).toContain("pointSummary,");
  });

  it("reads directory point balances inside one purpose-built RPC", () => {
    const query = source(
      "src/features/students/server/queries/student-directory-query.ts",
    );
    const migration = source(
      "supabase/migrations/20260829213000_add_admin_student_directory_read_model.sql",
    );
    expect(query).toContain('"get_admin_student_directory_initial_v1"');
    expect(query).not.toContain("listStudentPointBalances(");
    expect(migration).toContain("student_point_totals");
    expect(migration).toContain("rawPoints");
  });

  it("loads one admin attempt and its point breakdown together", () => {
    const query = source(
      "src/features/history/server/queries/admin-history-detail-query.ts",
    );
    expect(query).toContain("const [attempt, pointSummary] = summary.attemptId");
    expect(query).toContain("getAdminAttemptDetail(summary.attemptId, admin)");
    expect(query).toContain(
      "getAdminAttemptPointSummary(summary.studentId, summary.attemptId)",
    );
    expect(query).toContain("pointSummary,");
  });
});
