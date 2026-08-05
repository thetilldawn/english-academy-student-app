import { describe, expect, it } from "vitest";

import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { buildStudentProgress } from "@/lib/admin/progress";

const student = {
  id: "student-1",
  currentVocabDatasetId: "dataset-current",
};
const units = [
  ...Array.from({ length: 7 }, (_, index) => ({
    id: `unit-${index + 1}`,
    datasetId: "dataset-current",
    label: `DAY ${String(index + 1).padStart(2, "0")}`,
    sortIndex: index + 1,
  })),
];

function history(
  overrides: Partial<AssignmentHistorySummary> = {},
): AssignmentHistorySummary {
  return {
    id: "attempt-1",
    attemptId: "attempt-1",
    assignmentId: "assignment-1",
    assignmentTitle: "DAY 01 시험",
    assignmentDeleted: false,
    assignmentStatus: "active",
    assignmentPurpose: "regular",
    studentId: student.id,
    studentName: "테스트 학생",
    studentDeleted: false,
    schoolName: null,
    gradeLabel: null,
    datasetId: "dataset-current",
    datasetTitle: "능률 VOCA",
    unitIds: ["unit-1"],
    unitLabels: ["DAY 01"],
    primaryUnitIds: ["unit-1"],
    primaryUnitLabels: ["DAY 01"],
    questionCount: 10,
    englishToKoreanRatio: 50,
    timeLimitSeconds: 300,
    passingScore: 80,
    questionOrderMode: "random",
    availableUntil: null,
    assignedAt: "2026-07-28T00:00:00.000Z",
    missedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    attemptNumber: 1,
    status: "completed",
    phase: "completed",
    activityAt: "2026-07-29T00:00:00.000Z",
    initialCorrectCount: 8,
    retryCorrectCount: 2,
    unresolvedWrongCount: 0,
    initialScore: 80,
    finalScore: 100,
    passed: true,
    startedAt: "2026-07-29T00:00:00.000Z",
    retryStartedAt: "2026-07-29T00:03:00.000Z",
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

  it("삭제된 테스트 시험은 최근 상태와 다음 DAY 추천에서 제외한다", () => {
    const [progress] = buildStudentProgress(
      [student],
      units,
      [
        history({
          id: "deleted-test",
          assignmentDeleted: true,
          assignmentTitle: "삭제됨",
          activityAt: "2026-07-31T00:00:00.000Z",
        }),
        history(),
      ],
    );

    expect(progress.latestAssignmentTitle).toBe("DAY 01 시험");
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

  it("마감 미응시는 같은 범위를 다시 배정하도록 추천한다", () => {
    const [progress] = buildStudentProgress(
      [student],
      units,
      [
        history({
          id: "missed",
          attemptId: null,
          attemptNumber: null,
          status: "missed",
          availableUntil: "2026-07-31T00:00:00.000Z",
          activityAt: "2026-07-31T00:00:00.000Z",
          initialScore: null,
          finalScore: null,
          passed: null,
          startedAt: null,
          completedAt: null,
        }),
      ],
    );

    expect(progress.latestStatus).toBe("missed");
    expect(progress.recommendationReason).toBe("repeat");
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

  it("첫 시험 검토 중에는 첫 점수를 유지하고 같은 시험을 이어서 추천한다", () => {
    const [progress] = buildStudentProgress(
      [student],
      units,
      [
        history({
          status: "in_progress",
          phase: "review",
          initialCorrectCount: 5,
          retryCorrectCount: 0,
          unresolvedWrongCount: 5,
          initialScore: 50,
          finalScore: null,
          passed: null,
          completedAt: null,
        }),
      ],
    );

    expect(progress.latestInitialScore).toBe(50);
    expect(progress.latestFinalScore).toBeNull();
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
          primaryUnitIds: [],
          primaryUnitLabels: ["원본 행 1~20"],
        }),
      ],
    );

    expect(progress.recommendationReason).toBe("manual");
    expect(progress.recommendedUnitId).toBeNull();
    expect(progress.recommendedUnitLabel).toBeNull();
  });

  it("최근 오답 재시험은 표시하되 정규 DAY 다음 추천은 유지한다", () => {
    const [progress] = buildStudentProgress(
      [student],
      units,
      [
        history({
          id: "review",
          attemptId: "review",
          assignmentTitle: "오답 재시험",
          assignmentPurpose: "review",
          unitIds: ["unit-1"],
          unitLabels: ["DAY 01"],
          primaryUnitIds: [],
          primaryUnitLabels: [],
          questionCount: 3,
          activityAt: "2026-07-30T00:00:00.000Z",
        }),
        history(),
      ],
    );

    expect(progress.latestAssignmentTitle).toBe("오답 재시험");
    expect(progress.latestUnitLabel).toBe("오답 재시험 · 3문항");
    expect(progress.recommendedUnitLabel).toBe("DAY 02");
    expect(progress.recommendationReason).toBe("next");
  });

  it("응시 전·진행 중 오답 재시험도 정규 배정 추천을 덮지 않는다", () => {
    const [progress] = buildStudentProgress(
      [student],
      units,
      [
        history({
          id: "review",
          attemptId: "review",
          assignmentPurpose: "review",
          primaryUnitIds: [],
          primaryUnitLabels: [],
          status: "in_progress",
          passed: null,
          completedAt: null,
          activityAt: "2026-07-31T00:00:00.000Z",
        }),
        history({
          id: "regular-pending",
          attemptId: null,
          attemptNumber: null,
          status: "not_started",
          initialScore: null,
          finalScore: null,
          passed: null,
          startedAt: null,
          completedAt: null,
        }),
      ],
    );

    expect(progress.latestStatus).toBe("in_progress");
    expect(progress.recommendationReason).toBe("assigned");
    expect(progress.recommendedUnitLabel).toBe("DAY 01");
  });

  it("오답 재시험 기록만 있으면 현재 단어장의 첫 DAY를 추천한다", () => {
    const [progress] = buildStudentProgress(
      [student],
      units,
      [
        history({
          assignmentPurpose: "review",
          primaryUnitIds: [],
          primaryUnitLabels: [],
        }),
      ],
    );

    expect(progress.recommendationReason).toBe("first");
    expect(progress.recommendedUnitLabel).toBe("DAY 01");
  });

  it("혼합 시험 실패 시 지원 범위가 아닌 주 DAY부터 다시 추천한다", () => {
    const [progress] = buildStudentProgress(
      [student],
      units,
      [
        history({
          assignmentPurpose: "mixed",
          unitIds: ["unit-1", "unit-2", "unit-3", "unit-4", "unit-5"],
          unitLabels: [
            "DAY 01",
            "DAY 02",
            "DAY 03",
            "DAY 04",
            "DAY 05",
          ],
          primaryUnitIds: ["unit-5"],
          primaryUnitLabels: ["DAY 05"],
          initialScore: 50,
          finalScore: 50,
          passed: false,
        }),
      ],
    );

    expect(progress.latestUnitLabel).toBe("DAY 05 · 오답 포함");
    expect(progress.recommendationReason).toBe("repeat");
    expect(progress.recommendedUnitLabel).toBe("DAY 05");
  });

  it("혼합 시험 통과 시 마지막 주 DAY 다음을 추천한다", () => {
    const [progress] = buildStudentProgress(
      [student],
      units,
      [
        history({
          assignmentPurpose: "mixed",
          unitIds: [
            "unit-1",
            "unit-2",
            "unit-3",
            "unit-4",
            "unit-5",
            "unit-6",
          ],
          unitLabels: [
            "DAY 01",
            "DAY 02",
            "DAY 03",
            "DAY 04",
            "DAY 05",
            "DAY 06",
          ],
          primaryUnitIds: ["unit-5", "unit-6"],
          primaryUnitLabels: ["DAY 05", "DAY 06"],
        }),
      ],
    );

    expect(progress.latestUnitLabel).toBe(
      "DAY 05~DAY 06 · 오답 포함",
    );
    expect(progress.recommendationReason).toBe("next");
    expect(progress.recommendedUnitLabel).toBe("DAY 07");
  });
});
