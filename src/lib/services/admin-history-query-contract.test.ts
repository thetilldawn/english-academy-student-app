import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve("src/lib/services/admin-service.ts"),
  "utf8",
);
const quizSource = fs.readFileSync(
  path.resolve("src/lib/services/quiz-service.ts"),
  "utf8",
);
const studentCard = fs.readFileSync(
  path.resolve(
    "src/features/student-dashboard/ui/student-assignment-card.tsx",
  ),
  "utf8",
);
const studentDashboardDomain = fs.readFileSync(
  path.resolve(
    "src/features/student-dashboard/domain/student-assignment-sections.ts",
  ),
  "utf8",
);

describe("admin assignment history query contract", () => {
  it("시험 목적과 주 DAY를 함께 조회하고 내역 모델로 전달한다", () => {
    expect(source).toContain("assignment_purpose,");
    expect(source).toContain("is_primary,");
    expect(source).toContain(
      "assignmentPurpose: assignment.assignment_purpose",
    );
    expect(source).toContain("primaryUnitIds:");
    expect(source).toContain("primaryUnitLabels:");
    expect(source).toContain("timing_mode,");
    expect(source).toContain("question_time_limit_seconds,");
    expect(source).toContain("available_from,");
    expect(source).toContain("timingMode: assignment.timing_mode");
    expect(source).toContain(
      "questionTimeLimitSeconds: assignment.question_time_limit_seconds",
    );
    expect(source).toContain("availableFrom: assignment.available_from");
  });

  it("학생 배정 목록도 시험 목적과 주 DAY만 표시한다", () => {
    expect(quizSource).toContain(
      '"id, title, assignment_purpose, dataset_id',
    );
    expect(quizSource).toContain(
      '"assignment_id, position, is_primary, vocab_units(unit_label)"',
    );
    expect(quizSource).toContain("primaryUnitLabelsByAssignment");
    expect(quizSource).toContain("scopeLabel: assignmentScopeLabel");
    expect(studentCard).toContain("{assignment.scopeLabel}");
    expect(studentCard).toContain("assignmentOrderLabel(");
    expect(studentCard).toContain(
      'assignment.assignmentPurpose !== "review"',
    );
  });

  it("persists missed assignment state across admin and student queries", () => {
    expect(source).toContain("missed_at,");
    expect(source).toContain("missedAt: row.missed_at");
    expect(quizSource).toContain(
      "finalizeStudentMissedAssignments(studentId)",
    );
    expect(quizSource).toContain(
      '.select("assignment_id, assigned_at, missed_at, cancelled_at")',
    );
    expect(quizSource).toContain('.is("cancelled_at", null)');
    expect(quizSource).toContain("missedAtByAssignment");
    expect(studentDashboardDomain).toContain(
      "missedAt: assignment.missedAt",
    );
    expect(studentDashboardDomain).toContain(
      "studentAssignmentActivityInput(left)",
    );
    expect(studentDashboardDomain).toContain(
      "studentAssignmentActivityInput(right)",
    );
    expect(studentDashboardDomain).toContain(
      'state.kind === "missed"',
    );
    expect(quizSource).toContain("!missed &&");
  });

  it("does not turn student assignment query failures into an empty dashboard", () => {
    expect(quizSource).toContain("if (linkError) {");
    expect(quizSource).toContain("if (assignmentError || attemptError) {");
    expect(quizSource).toContain(
      "if (datasetError || assignmentUnitError) {",
    );
  });
});
