import { describe, expect, it } from "vitest";

import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { buildStudentProgress } from "@/lib/admin/progress";

const student = {
  id: "student-1",
  currentVocabDatasetId: "dataset-current",
};
const units = [
  {
    id: "unit-1",
    datasetId: "dataset-current",
    label: "DAY 01",
    sortIndex: 1,
  },
  {
    id: "unit-2",
    datasetId: "dataset-current",
    label: "DAY 02",
    sortIndex: 2,
  },
];

function history(
  overrides: Partial<AssignmentHistorySummary> = {},
): AssignmentHistorySummary {
  return {
    id: "attempt-1",
    attemptId: "attempt-1",
    assignmentId: "assignment-1",
    assignmentTitle: "DAY 01 시험",
    assignmentStatus: "active",
    studentId: student.id,
    studentName: "테스트 학생",
    schoolName: null,
    gradeLabel: null,
    datasetId: "dataset-current",
    datasetTitle: "능률 VOCA",
    unitIds: ["unit-1"],
    unitLabels: ["DAY 01"],
    questionCount: 10,
    englishToKoreanRatio: 50,
    timeLimitSeconds: 300,
    passingScore: 80,
    questionOrderMode: "random",
    assignedAt: "2026-07-28T00:00:00.000Z",
    attemptNumber: 1,
    status: "completed",
    activityAt: "2026-07-29T00:00:00.000Z",
    initialCorrectCount: 8,
    retryCorrectCount: 2,
    unresolvedWrongCount: 0,
    initialScore: 80,
    finalScore: 100,
    passed: true,
    startedAt: "2026-07-29T00:00:00.000Z",
    deadlineAt: "2026-07-29T00:10:00.000Z",
    completedAt: "2026-07-29T00:05:00.000Z",
    ...overrides,
  };
}

describe("buildStudentProgress", () => {
  it("첫 시험과 최종 점수를 함께 반환하고 다음 DAY를 추천한다", () => {
    const [progress] = buildStudentProgress(
      [student],
      units,
      [history()],
    );

    expect(progress.latestInitialScore).toBe(80);
    expect(progress.latestFinalScore).toBe(100);
    expect(progress.recommendedUnitLabel).toBe("DAY 02");
    expect(progress.recommendationReason).toBe("next");
  });

  it("다른 단어장 시험도 최근 표시에 남기되 추천은 현재 단어장으로 계산한다", () => {
    const [progress] = buildStudentProgress(
      [student],
      units,
      [
        history({
          id: "other-attempt",
          attemptId: "other-attempt",
          assignmentTitle: "다른 단어장 시험",
          datasetId: "dataset-other",
          activityAt: "2026-07-30T00:00:00.000Z",
        }),
        history(),
      ],
    );

    expect(progress.latestAssignmentTitle).toBe("다른 단어장 시험");
    expect(progress.recommendedUnitLabel).toBe("DAY 02");
  });

  it("미응시 배정이 있으면 그 범위를 먼저 표시한다", () => {
    const [progress] = buildStudentProgress(
      [student],
      units,
      [
        history({
          id: "not-started",
          attemptId: null,
          attemptNumber: null,
          status: "not_started",
          initialScore: null,
          finalScore: null,
          startedAt: null,
          completedAt: null,
        }),
      ],
    );

    expect(progress.latestStatus).toBe("not_started");
    expect(progress.recommendationReason).toBe("assigned");
    expect(progress.recommendedUnitLabel).toBe("DAY 01");
  });

  it("입력 순서와 관계없이 전체 최신 시험을 표시한다", () => {
    const [progress] = buildStudentProgress(
      [student],
      units,
      [
        history({
          id: "older",
          assignmentTitle: "과거 시험",
          activityAt: "2026-07-27T00:00:00.000Z",
        }),
        history({
          id: "newer",
          assignmentTitle: "최근 시험",
          activityAt: "2026-07-31T00:00:00.000Z",
        }),
      ],
    );

    expect(progress.latestAssignmentTitle).toBe("최근 시험");
  });

  it("새 미응시 배정보다 진행 중인 시험을 먼저 이어서 추천한다", () => {
    const [progress] = buildStudentProgress(
      [student],
      units,
      [
        history({
          id: "not-started",
          attemptId: null,
          attemptNumber: null,
          status: "not_started",
          activityAt: "2026-07-31T00:00:00.000Z",
          initialScore: null,
          finalScore: null,
          startedAt: null,
          completedAt: null,
        }),
        history({
          id: "in-progress",
          status: "in_progress",
          activityAt: "2026-07-30T00:00:00.000Z",
          initialScore: null,
          finalScore: null,
          passed: null,
          completedAt: null,
        }),
      ],
    );

    expect(progress.latestStatus).toBe("not_started");
    expect(progress.recommendationReason).toBe("resume");
    expect(progress.recommendedUnitLabel).toBe("DAY 01");
  });

  it("DAY 연결이 없는 과거 시험은 다음 범위를 추측하지 않는다", () => {
    const [progress] = buildStudentProgress(
      [student],
      units,
      [
        history({
          unitIds: [],
          unitLabels: ["원본 행 1~20"],
        }),
      ],
    );

    expect(progress.recommendationReason).toBe("manual");
    expect(progress.recommendedUnitId).toBeNull();
    expect(progress.recommendedUnitLabel).toBeNull();
  });
});
