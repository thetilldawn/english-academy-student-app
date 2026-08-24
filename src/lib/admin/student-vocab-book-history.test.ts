import { describe, expect, it } from "vitest";

import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { buildStudentVocabBookHistory } from "@/lib/admin/student-vocab-book-history";

function activity(
  overrides: Partial<AssignmentHistorySummary>,
): AssignmentHistorySummary {
  return {
    id: "attempt-a",
    attemptId: "attempt-a",
    assignmentId: "assignment-a",
    assignmentTitle: "시험",
    assignmentDeleted: false,
    assignmentStatus: "closed",
    assignmentPurpose: "regular",
    studentId: "student-a",
    studentName: "학생",
    studentDeleted: false,
    studentStatus: "active",
    schoolName: null,
    gradeLabel: null,
    datasetId: "dataset-a",
    datasetTitle: "VOCA",
    unitIds: ["unit-12"],
    unitLabels: ["DAY 12"],
    primaryUnitIds: ["unit-12"],
    primaryUnitLabels: ["DAY 12"],
    questionCount: 20,
    englishToKoreanRatio: 50,
    timeLimitSeconds: 300,
    timingMode: "total",
    questionTimeLimitSeconds: null,
    passingScore: 80,
    questionOrderMode: "random",
    availableFrom: null,
    availableUntil: null,
    assignedAt: "2026-08-01T00:00:00.000Z",
    missedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    attemptNumber: 1,
    status: "completed",
    phase: "completed",
    activityAt: "2026-08-01T00:10:00.000Z",
    initialCorrectCount: 20,
    retryCorrectCount: null,
    unresolvedWrongCount: 0,
    initialScore: 100,
    finalScore: 100,
    passed: true,
    startedAt: "2026-08-01T00:00:00.000Z",
    retryStartedAt: null,
    deadlineAt: "2026-08-01T00:05:00.000Z",
    completedAt: "2026-08-01T00:10:00.000Z",
    ...overrides,
  };
}

describe("student vocabulary book history", () => {
  it("keeps an earlier wordbook after the current wordbook changes", () => {
    const result = buildStudentVocabBookHistory([
      activity({}),
      activity({
        id: "attempt-b",
        attemptId: "attempt-b",
        assignmentId: "assignment-b",
        datasetId: "dataset-b",
        datasetTitle: "모의고사",
        unitIds: ["chapter-1"],
        unitLabels: ["1장"],
        primaryUnitIds: ["chapter-1"],
        primaryUnitLabels: ["1장"],
        status: "in_progress",
        phase: "initial",
        passed: null,
        initialScore: null,
        finalScore: null,
        completedAt: null,
        startedAt: "2026-08-02T00:00:00.000Z",
        activityAt: "2026-08-02T00:00:00.000Z",
      }),
    ]);

    expect(result.map((item) => item.datasetId)).toEqual([
      "dataset-b",
      "dataset-a",
    ]);
    expect(result[1].lastScopeLabel).toBe("DAY 12");
  });

  it("uses only primary units for mixed progress and ignores review-only work", () => {
    const result = buildStudentVocabBookHistory([
      activity({
        assignmentPurpose: "mixed",
        unitLabels: ["DAY 01", "DAY 02", "DAY 05"],
        primaryUnitLabels: ["DAY 05"],
      }),
      activity({
        id: "review-attempt",
        attemptId: "review-attempt",
        assignmentPurpose: "review",
        completedAt: "2026-08-03T00:00:00.000Z",
        activityAt: "2026-08-03T00:00:00.000Z",
        unitLabels: ["DAY 01", "DAY 02"],
        primaryUnitLabels: [],
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].lastScopeLabel).toBe("DAY 05");
    expect(result[0].attemptCount).toBe(1);
  });

  it("shows a sparse latest range without pretending it is continuous", () => {
    const result = buildStudentVocabBookHistory([
      activity({
        unitIds: ["unit-1", "unit-3"],
        unitLabels: ["DAY 01", "DAY 03"],
        unitSortIndexes: [1, 3],
        primaryUnitIds: ["unit-1", "unit-3"],
        primaryUnitLabels: ["DAY 01", "DAY 03"],
        primaryUnitSortIndexes: [1, 3],
      }),
    ]);

    expect(result[0].lastScopeLabel).toBe("DAY 01 외 1개");
  });

  it("excludes assignments that were never attempted", () => {
    const result = buildStudentVocabBookHistory([
      activity({
        id: "assignment-a:student-a",
        attemptId: null,
        attemptNumber: null,
        status: "missed",
        phase: null,
        startedAt: null,
        completedAt: null,
        missedAt: "2026-08-02T00:00:00.000Z",
      }),
    ]);

    expect(result).toEqual([]);
  });
});
