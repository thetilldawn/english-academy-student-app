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

  it("uses one batch balance read for the admin student directory", () => {
    const loader = source(
      "src/features/students/server/load-student-management-data.ts",
    );
    expect(loader).toContain("const directoryPromise = loadStudentDirectoryBundle()");
    expect(loader).toContain("listStudentPointBalances(");
    expect(loader).toContain("directory.students.map((student) => student.id)");
    expect(loader).toContain("pointBalancesPromise");
    expect(loader).not.toMatch(/students\.map\(async/);
  });

  it("loads one admin attempt and its point breakdown together", () => {
    const service = source("src/lib/services/admin-history-read-service.ts");
    expect(service).toContain("const [attempt, pointSummary] = summary.attemptId");
    expect(service).toContain("getAdminAttemptDetail(summary.attemptId)");
    expect(service).toContain(
      "getAdminAttemptPointSummary(summary.studentId, summary.attemptId)",
    );
    expect(service).toContain("pointSummary,");
  });
});
