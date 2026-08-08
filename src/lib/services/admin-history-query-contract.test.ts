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
const studentPage = fs.readFileSync(
  path.resolve("src/app/student/(protected)/page.tsx"),
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
    expect(studentPage).toContain("{assignment.scopeLabel}");
    expect(studentPage).toContain("assignmentOrderLabel(");
    expect(studentPage).toContain(
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
    expect(quizSource).toContain("missedAt: left.missedAt");
    expect(quizSource).toContain("!missed &&");
  });
});
