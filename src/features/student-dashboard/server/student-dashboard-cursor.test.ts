import { describe, expect, it } from "vitest";

import {
  StudentDashboardCursorError,
  assertStudentDashboardCursorOwner,
  decodeStudentDashboardCursor,
  encodeStudentDashboardCursor,
  studentDashboardStudentFingerprint,
} from "./student-dashboard-cursor";

const studentId = "11111111-1111-4111-8111-111111111111";
const payload = {
  assignmentId: "22222222-2222-4222-8222-222222222222",
  effectiveAt: "2026-08-28T23:59:59.000Z",
  snapshotAt: "2026-08-29T00:00:00.000Z",
  studentFingerprint: studentDashboardStudentFingerprint(studentId),
  version: 1 as const,
};

describe("student dashboard cursor", () => {
  it("학생 지문과 복합 정렬 기준을 불투명 커서로 왕복한다", () => {
    const encoded = encodeStudentDashboardCursor(payload);
    expect(encoded).not.toContain(studentId);
    expect(decodeStudentDashboardCursor(encoded)).toEqual(payload);
    expect(() => assertStudentDashboardCursorOwner(payload, studentId))
      .not.toThrow();
  });

  it("다른 학생, 잘못된 형식, snapshot 이후 기준을 거부한다", () => {
    expect(() => assertStudentDashboardCursorOwner(
      payload,
      "33333333-3333-4333-8333-333333333333",
    )).toThrow(StudentDashboardCursorError);
    expect(() => decodeStudentDashboardCursor("invalid"))
      .toThrow(StudentDashboardCursorError);
    expect(() => decodeStudentDashboardCursor(
      encodeStudentDashboardCursor({
        ...payload,
        effectiveAt: "2026-08-29T00:00:01.000Z",
      }),
    )).toThrow(StudentDashboardCursorError);
    expect(() => decodeStudentDashboardCursor(
      encodeStudentDashboardCursor({
        ...payload,
        effectiveAt: "2099-01-01T00:00:00.000Z",
        snapshotAt: "2099-01-01T00:00:00.000Z",
      }),
    )).toThrow(StudentDashboardCursorError);
  });
});
