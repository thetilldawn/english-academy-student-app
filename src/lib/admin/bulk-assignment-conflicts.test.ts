import { describe, expect, it } from "vitest";

import {
  bulkScheduleCollisionId,
  enforceIncreasingResolvedSchedules,
  resolveBulkScheduleCollision,
} from "./bulk-assignment-conflicts";

const studentId = "00000000-0000-4000-8000-000000000001";
const existingAssignmentId = "00000000-0000-4000-8000-000000000010";
const schedule = {
  availableFrom: "2026-08-17T09:00:00.000Z",
  availableUntil: "2026-08-18T13:00:00.000Z",
};
const existing = [{
  assignmentId: existingAssignmentId,
  assignmentTitle: "기존 시험",
  availableFrom: "2026-08-17T03:00:00.000Z",
}];

describe("일괄 배정 날짜 겹침", () => {
  it("결정 전에는 경고를 미해결로 반환한다", () => {
    const result = resolveBulkScheduleCollision({
      studentId,
      sourceSessionNumber: 1,
      schedule,
      existingAssignments: existing,
      decisions: [],
    });
    expect(result.kind).toBe("scheduled");
    if (result.kind !== "scheduled") return;
    expect(result.unresolved).toBe(true);
    expect(result.warnings[0]).toMatchObject({
      existingAssignmentId,
      resolved: false,
    });
  });

  it("허용은 새 후보를 유지하고 건너뜀은 새 후보만 제외한다", () => {
    const collisionId = bulkScheduleCollisionId(studentId, 1, existingAssignmentId);
    const allowed = resolveBulkScheduleCollision({
      studentId,
      sourceSessionNumber: 1,
      schedule,
      existingAssignments: existing,
      decisions: [{
        collisionId,
        mode: "allow",
        movedAvailableFrom: null,
        movedAvailableUntil: null,
      }],
    });
    expect(allowed).toMatchObject({
      kind: "scheduled",
      unresolved: false,
      schedule,
    });
    expect(resolveBulkScheduleCollision({
      studentId,
      sourceSessionNumber: 1,
      schedule,
      existingAssignments: existing,
      decisions: [{
        collisionId,
        mode: "skip",
        movedAvailableFrom: null,
        movedAvailableUntil: null,
      }],
    })).toEqual({ kind: "skip" });
    expect(existing).toEqual([{
      assignmentId: existingAssignmentId,
      assignmentTitle: "기존 시험",
      availableFrom: "2026-08-17T03:00:00.000Z",
    }]);
  });

  it("이동 뒤 새 날짜에 겹침이 없으면 경고가 해결된다", () => {
    const collisionId = bulkScheduleCollisionId(studentId, 1, existingAssignmentId);
    const result = resolveBulkScheduleCollision({
      studentId,
      sourceSessionNumber: 1,
      schedule,
      existingAssignments: existing,
      decisions: [{
        collisionId,
        mode: "move",
        movedAvailableFrom: "2026-08-18T09:00:00.000Z",
        movedAvailableUntil: "2026-08-19T13:00:00.000Z",
      }],
    });
    expect(result).toMatchObject({
      kind: "scheduled",
      unresolved: false,
      schedule: {
        availableFrom: "2026-08-18T09:00:00.000Z",
        availableUntil: "2026-08-19T13:00:00.000Z",
      },
      warnings: [],
    });
  });

  it("이동한 날짜의 새 겹침에도 건너뜀과 추가 이동을 적용한다", () => {
    const secondAssignmentId = "00000000-0000-4000-8000-000000000011";
    const secondCollisionId = bulkScheduleCollisionId(
      studentId,
      1,
      secondAssignmentId,
    );
    const originalCollisionId = bulkScheduleCollisionId(
      studentId,
      1,
      existingAssignmentId,
    );
    const existingAssignments = [
      ...existing,
      {
        assignmentId: secondAssignmentId,
        assignmentTitle: "이동한 날의 기존 시험",
        availableFrom: "2026-08-18T03:00:00.000Z",
      },
    ];
    const originalMove = {
      collisionId: originalCollisionId,
      mode: "move" as const,
      movedAvailableFrom: "2026-08-18T09:00:00.000Z",
      movedAvailableUntil: "2026-08-19T13:00:00.000Z",
    };

    expect(resolveBulkScheduleCollision({
      studentId,
      sourceSessionNumber: 1,
      schedule,
      existingAssignments,
      decisions: [
        originalMove,
        {
          collisionId: secondCollisionId,
          mode: "skip",
          movedAvailableFrom: null,
          movedAvailableUntil: null,
        },
      ],
    })).toEqual({ kind: "skip" });

    expect(resolveBulkScheduleCollision({
      studentId,
      sourceSessionNumber: 1,
      schedule,
      existingAssignments,
      decisions: [
        originalMove,
        {
          collisionId: secondCollisionId,
          mode: "move",
          movedAvailableFrom: "2026-08-19T09:00:00.000Z",
          movedAvailableUntil: "2026-08-20T13:00:00.000Z",
        },
      ],
    })).toMatchObject({
      kind: "scheduled",
      unresolved: false,
      schedule: { availableFrom: "2026-08-19T09:00:00.000Z" },
    });
  });

  it("이동으로 새 회차 순서가 겹치면 원래 결정을 다시 고르게 한다", () => {
    const collisionId = bulkScheduleCollisionId(
      studentId,
      1,
      existingAssignmentId,
    );
    const result = enforceIncreasingResolvedSchedules({
      studentId,
      decisions: [{
        collisionId,
        mode: "move",
        movedAvailableFrom: "2026-08-19T09:00:00.000Z",
        movedAvailableUntil: "2026-08-20T13:00:00.000Z",
      }],
      sessions: [
        {
          sourceSessionNumber: 1,
          available: true,
          availableFrom: "2026-08-19T09:00:00.000Z",
          availableUntil: "2026-08-20T13:00:00.000Z",
          questionCount: 40,
          warnings: [],
          error: null,
        },
        {
          sourceSessionNumber: 2,
          available: true,
          availableFrom: "2026-08-19T09:00:00.000Z",
          availableUntil: "2026-08-20T13:00:00.000Z",
          questionCount: 40,
          warnings: [],
          error: null,
        },
      ],
    });

    expect(result[0]).toMatchObject({
      available: false,
      error: "이동한 날짜가 이번 배정의 다른 회차와 겹칩니다.",
      questionCount: 0,
      warnings: [{ id: collisionId, resolved: false }],
    });
  });

  it("이동 뒤 시각 순서는 맞아도 같은 한국 날짜가 되면 미리보기를 막는다", () => {
    const collisionId = bulkScheduleCollisionId(
      studentId,
      1,
      existingAssignmentId,
    );
    const result = enforceIncreasingResolvedSchedules({
      studentId,
      decisions: [{
        collisionId,
        mode: "move",
        movedAvailableFrom: "2026-08-19T00:00:00.000Z",
        movedAvailableUntil: "2026-08-20T13:00:00.000Z",
      }],
      sessions: [
        {
          sourceSessionNumber: 1,
          available: true,
          availableFrom: "2026-08-19T00:00:00.000Z",
          availableUntil: "2026-08-20T13:00:00.000Z",
          questionCount: 40,
          warnings: [],
          error: null,
        },
        {
          sourceSessionNumber: 2,
          available: true,
          availableFrom: "2026-08-19T09:00:00.000Z",
          availableUntil: "2026-08-20T13:00:00.000Z",
          questionCount: 40,
          warnings: [],
          error: null,
        },
      ],
    });
    expect(result[0]).toMatchObject({
      available: false,
      error: "이동한 날짜가 이번 배정의 다른 회차와 겹칩니다.",
    });
  });
});
