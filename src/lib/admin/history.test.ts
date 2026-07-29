import { describe, expect, it } from "vitest";

import {
  buildAssignmentHistory,
  type AssignmentHistorySource,
  type AttemptHistorySource,
} from "@/lib/admin/history";

const assignment: AssignmentHistorySource = {
  assignmentId: "assignment-1",
  assignmentTitle: "능률 VOCA DAY 01",
  assignmentStatus: "active",
  studentId: "student-1",
  studentName: "테스트 학생",
  schoolName: "테스트고등학교",
  gradeLabel: "고1",
  datasetId: "dataset-1",
  datasetTitle: "능률 VOCA 어원편 · 2025개정",
  unitIds: ["unit-1"],
  unitLabels: ["DAY 01"],
  questionCount: 10,
  englishToKoreanRatio: 50,
  timeLimitSeconds: 300,
  passingScore: 80,
  questionOrderMode: "random",
  assignedAt: "2026-07-29T00:00:00.000Z",
};

function attempt(
  overrides: Partial<AttemptHistorySource> = {},
): AttemptHistorySource {
  return {
    id: "attempt-1",
    assignmentId: assignment.assignmentId,
    studentId: assignment.studentId,
    attemptNumber: 1,
    status: "completed",
    questionCount: 10,
    timeLimitSeconds: 240,
    passingScore: 85,
    initialCorrectCount: 8,
    retryCorrectCount: 2,
    unresolvedWrongCount: 0,
    initialScore: 80,
    finalScore: 100,
    passed: true,
    startedAt: "2026-07-29T01:00:00.000Z",
    deadlineAt: "2026-07-29T01:10:00.000Z",
    completedAt: "2026-07-29T01:05:00.000Z",
    ...overrides,
  };
}

describe("buildAssignmentHistory", () => {
  it("배정만 있고 응시가 없으면 미응시 이력을 만든다", () => {
    const [item] = buildAssignmentHistory([assignment], []);

    expect(item.status).toBe("not_started");
    expect(item.attemptId).toBeNull();
    expect(item.activityAt).toBe(assignment.assignedAt);
  });

  it("같은 배정의 실제 응시가 있으면 가짜 미응시를 만들지 않는다", () => {
    const result = buildAssignmentHistory(
      [assignment],
      [
        attempt(),
        attempt({
          id: "attempt-2",
          attemptNumber: 2,
          startedAt: "2026-07-30T01:00:00.000Z",
        }),
      ],
    );

    expect(result).toHaveLength(2);
    expect(result.every((item) => item.status !== "not_started")).toBe(true);
    expect(result.map((item) => item.attemptNumber)).toEqual([2, 1]);
  });

  it("첫 시험과 재시험 반영 후 점수를 모두 보존한다", () => {
    const [item] = buildAssignmentHistory([assignment], [attempt()]);

    expect(item.initialScore).toBe(80);
    expect(item.finalScore).toBe(100);
    expect(item.initialCorrectCount).toBe(8);
    expect(item.retryCorrectCount).toBe(2);
    expect(item.unresolvedWrongCount).toBe(0);
    expect(item.timeLimitSeconds).toBe(240);
    expect(item.passingScore).toBe(85);
  });

  it("마감이 지난 진행 중 응시는 관리자 이력에서 시간 종료로 본다", () => {
    const [item] = buildAssignmentHistory(
      [assignment],
      [
        attempt({
          status: "in_progress",
          initialCorrectCount: null,
          retryCorrectCount: null,
          unresolvedWrongCount: null,
          initialScore: null,
          finalScore: null,
          passed: null,
          completedAt: null,
          deadlineAt: "2026-07-29T01:02:00.000Z",
        }),
      ],
      Date.parse("2026-07-29T01:03:00.000Z"),
    );

    expect(item.status).toBe("expired");
  });
});
