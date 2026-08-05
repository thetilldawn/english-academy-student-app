import { describe, expect, it } from "vitest";

import {
  assignmentDisplayTitle,
  assignmentOrderLabel,
  assignmentScopeLabel,
  buildAssignmentHistory,
  type AssignmentHistorySource,
  type AttemptHistorySource,
} from "@/lib/admin/history";

const assignment: AssignmentHistorySource = {
  assignmentId: "assignment-1",
  assignmentTitle: "능률 VOCA DAY 01",
  assignmentDeleted: false,
  assignmentStatus: "active",
  assignmentPurpose: "regular",
  studentId: "student-1",
  studentName: "테스트 학생",
  studentDeleted: false,
  schoolName: "테스트고등학교",
  gradeLabel: "고1",
  datasetId: "dataset-1",
  datasetTitle: "능률 VOCA 어원편 · 2025개정",
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
  assignedAt: "2026-07-29T00:00:00.000Z",
  missedAt: null,
  cancelledAt: null,
  cancellationReason: null,
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
    phase: "completed",
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
    retryStartedAt: "2026-07-29T01:03:00.000Z",
    deadlineAt: "2026-07-29T01:10:00.000Z",
    completedAt: "2026-07-29T01:05:00.000Z",
    ...overrides,
  };
}

describe("buildAssignmentHistory", () => {
  it("마감이 없고 응시도 없으면 응시 전 이력을 만든다", () => {
    const [item] = buildAssignmentHistory([assignment], []);

    expect(item.status).toBe("not_started");
    expect(item.attemptId).toBeNull();
    expect(item.activityAt).toBe(assignment.assignedAt);
  });

  it("마감 전이며 응시가 없으면 응시 전 상태를 유지한다", () => {
    const [item] = buildAssignmentHistory(
      [
        {
          ...assignment,
          availableUntil: "2026-07-31T00:00:00.000Z",
        },
      ],
      [],
      Date.parse("2026-07-30T23:59:59.999Z"),
    );

    expect(item.status).toBe("not_started");
  });

  it("마감과 같은 시각에는 영속 확정 전에도 미응시로 표시한다", () => {
    const deadline = "2026-07-31T00:00:00.000Z";
    const [item] = buildAssignmentHistory(
      [{ ...assignment, availableUntil: deadline }],
      [],
      Date.parse(deadline),
    );

    expect(item.status).toBe("missed");
    expect(item.activityAt).toBe(deadline);
    expect(item.attemptId).toBeNull();
    expect(item.id).toBe(
      `assignment:${assignment.assignmentId}:${assignment.studentId}`,
    );
  });

  it("저장된 마감 시각으로 미응시 이력을 만든다", () => {
    const deadline = "2026-07-31T00:00:00.000Z";
    const [item] = buildAssignmentHistory(
      [
        {
          ...assignment,
          availableUntil: deadline,
          missedAt: deadline,
        },
      ],
      [],
    );

    expect(item.status).toBe("missed");
    expect(item.activityAt).toBe(deadline);
    expect(item.id).toBe(
      `assignment:${assignment.assignmentId}:${assignment.studentId}`,
    );
  });

  it("저장된 미응시는 마감이 연장되어도 기존 이력을 유지한다", () => {
    const missedAt = "2026-07-31T00:00:00.000Z";
    const [item] = buildAssignmentHistory(
      [
        {
          ...assignment,
          availableUntil: "2026-08-02T00:00:00.000Z",
          missedAt,
        },
      ],
      [],
      Date.parse("2026-08-01T00:00:00.000Z"),
    );

    expect(item.status).toBe("missed");
    expect(item.activityAt).toBe(missedAt);
  });

  it("같은 배정의 실제 응시가 있으면 가짜 응시 전·미응시를 만들지 않는다", () => {
    const result = buildAssignmentHistory(
      [
        {
          ...assignment,
          availableUntil: "2026-07-29T00:30:00.000Z",
        },
      ],
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
    expect(
      result.every(
        (item) =>
          item.status !== "not_started" && item.status !== "missed",
      ),
    ).toBe(true);
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

  it("첫 시험 결과 검토 단계는 과거 제한시간이 지나도 진행 상태다", () => {
    const [item] = buildAssignmentHistory(
      [assignment],
      [
        attempt({
          status: "in_progress",
          phase: "review",
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

    expect(item.status).toBe("in_progress");
    expect(item.phase).toBe("review");
  });
});

describe("assignmentScopeLabel", () => {
  it("오답 재시험은 내부 지원 DAY 대신 선택 문항 수를 표시한다", () => {
    expect(
      assignmentScopeLabel({
        assignmentPurpose: "review",
        unitLabels: ["DAY 01", "DAY 02", "DAY 03"],
        primaryUnitLabels: [],
        questionCount: 3,
      }),
    ).toBe("오답 재시험 · 3문항");
  });

  it("혼합 시험은 주 DAY 범위와 오답 포함 여부를 표시한다", () => {
    expect(
      assignmentScopeLabel({
        assignmentPurpose: "mixed",
        unitLabels: ["DAY 01", "DAY 02", "DAY 03", "DAY 04", "DAY 05"],
        primaryUnitLabels: ["DAY 05"],
        questionCount: 10,
      }),
    ).toBe("DAY 05 · 오답 포함");
  });

  it("문제 순서는 교재 유형과 무관하게 같은 표현을 사용한다", () => {
    expect(assignmentOrderLabel("regular", "fixed")).toBe("오름차순");
    expect(assignmentOrderLabel("review", "ascending")).toBe("오름차순");
    expect(assignmentOrderLabel("mixed", "descending")).toBe("내림차순");
    expect(assignmentOrderLabel("mixed", "random")).toBe(
      "무작위 순서",
    );
  });
});

describe("assignmentDisplayTitle", () => {
  it("시험명에 반복된 DAY만 제거하고 원래 시험명은 보존한다", () => {
    expect(
      assignmentDisplayTitle({
        assignmentTitle: "새 시험 · DAY 01",
        unitLabels: ["DAY 01"],
        primaryUnitLabels: ["DAY 01"],
      }),
    ).toBe("새 시험");
    expect(
      assignmentDisplayTitle({
        assignmentTitle: "완료 · 다시 학습 필요",
        unitLabels: ["DAY 01"],
        primaryUnitLabels: ["DAY 01"],
      }),
    ).toBe("완료 · 다시 학습 필요");
  });
});
