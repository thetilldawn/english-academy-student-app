import { describe, expect, it } from "vitest";

import type { AssignmentHistorySummary } from "@/lib/admin/history";

import { selectPreviousVocabExamConditions } from "./vocab-previous-exam";

function history(
  overrides: Partial<AssignmentHistorySummary> = {},
): AssignmentHistorySummary {
  return {
    id: "history-1",
    attemptId: null,
    attemptNumber: null,
    assignmentId: "assignment-1",
    assignmentTitle: "DAY 10 시험",
    assignmentDeleted: false,
    assignmentStatus: "active",
    assignmentPurpose: "regular",
    studentId: "student-1",
    studentName: "김학생",
    studentDeleted: false,
    studentStatus: "active",
    schoolName: null,
    gradeLabel: null,
    datasetId: "dataset-1",
    datasetTitle: "VOCA",
    unitIds: ["unit-10"],
    unitLabels: ["DAY 10"],
    primaryUnitIds: ["unit-10"],
    primaryUnitLabels: ["DAY 10"],
    questionCount: 40,
    englishToKoreanRatio: 100,
    timeLimitSeconds: 300,
    timingMode: "per_question",
    questionTimeLimitSeconds: 15,
    passingScore: 85,
    questionOrderMode: "fixed",
    availableFrom: "2026-08-10T09:00:00.000Z",
    availableUntil: "2026-08-11T13:00:00.000Z",
    assignedAt: "2026-08-10T08:00:00.000Z",
    missedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    status: "not_started",
    phase: null,
    activityAt: "2026-08-10T08:00:00.000Z",
    initialCorrectCount: null,
    retryCorrectCount: null,
    unresolvedWrongCount: null,
    initialScore: null,
    finalScore: null,
    passed: null,
    startedAt: null,
    initialCompletedAt: null,
    retryStartedAt: null,
    deadlineAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("직전 단어 시험 조건", () => {
  it("같은 학생과 단어장의 최신 일반 시험 조건과 한국 시간 규칙을 고른다", () => {
    const result = selectPreviousVocabExamConditions({
      datasetId: "dataset-1",
      studentId: "student-1",
      history: [
        history(),
        history({
          assignmentId: "assignment-new",
          assignmentTitle: "DAY 20 시험",
          assignedAt: "2026-08-12T08:00:00.000Z",
          availableFrom: "2026-08-12T09:00:00.000Z",
          availableUntil: "2026-08-13T13:00:00.000Z",
          questionOrderMode: "descending",
          vocabUnitAllocation: {
            rule: {
              schemaVersion: 1,
              mode: "by_weekday",
              unitsPerSession: 2,
              weekdayUnitsPerSession: {
                1: 2, 2: 1, 3: 3, 4: 1, 5: 1, 6: 1, 7: 1,
              },
            },
            overflowPolicy: "continue_weekly",
          },
        }),
        history({
          assignmentId: "review-newest",
          assignmentPurpose: "review",
          assignedAt: "2026-08-14T08:00:00.000Z",
        }),
      ],
    });

    expect(result).toMatchObject({
      assignmentId: "assignment-new",
      assignmentTitle: "DAY 20 시험",
      exam: {
        directionRatio: 100,
        passingScore: 85,
        questionOrderMode: "ascending",
        timing: { mode: "per_question", perQuestionSeconds: 15 },
      },
      scheduleRule: {
        availableTime: "18:00",
        deadlineDayOffset: 1,
        deadlineTime: "22:00",
      },
      unitAllocation: {
        rule: {
          schemaVersion: 1,
          mode: "by_weekday",
          unitsPerSession: 2,
          weekdayUnitsPerSession: { 1: 2, 3: 3 },
        },
        overflowPolicy: "continue_weekly",
      },
    });
  });

  it("공개·마감 이력이 없으면 시험 조건만 복사하고 시간 규칙은 만들지 않는다", () => {
    const result = selectPreviousVocabExamConditions({
      datasetId: "dataset-1",
      studentId: "student-1",
      history: [history({ availableFrom: null, availableUntil: null })],
    });
    expect(result?.scheduleRule).toBeNull();
  });

  it("시간 제한이 없는 최근 시험도 복사 후보로 유지한다", () => {
    const result = selectPreviousVocabExamConditions({
      datasetId: "dataset-1",
      studentId: "student-1",
      history: [history({
        timingMode: "none",
        timeLimitSeconds: 0,
        questionTimeLimitSeconds: null,
      })],
    });
    expect(result?.exam).toMatchObject({
      timeLimitEnabled: false,
      timing: { mode: "total", totalSeconds: 300 },
    });
  });
});
