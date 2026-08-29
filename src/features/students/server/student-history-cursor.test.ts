import { describe, expect, it, vi } from "vitest";

import { emptyStudentHistoryFilters } from "../contracts/student-detail-read-model";
import {
  assertStudentHistoryCursorScope,
  decodeStudentHistoryCursor,
  encodeStudentHistoryCursor,
  StudentHistoryCursorError,
  studentHistoryFilterFingerprint,
} from "./student-history-cursor";

const studentId = "00000000-0000-4000-8000-000000000001";
const snapshotAt = "2026-08-29T00:00:00.000Z";

describe("student history cursor", () => {
  it("학생·필터·snapshot·복합 정렬키를 왕복한다", () => {
    const cursor = decodeStudentHistoryCursor(encodeStudentHistoryCursor({
      effectiveAt: "2026-08-28T00:00:00.000Z",
      entryKey: "attempt.example",
      filterFingerprint: studentHistoryFilterFingerprint(
        emptyStudentHistoryFilters,
      ),
      snapshotAt,
      studentId,
      version: 1,
    }));
    expect(cursor.studentId).toBe(studentId);
    expect(() => assertStudentHistoryCursorScope(cursor, {
      filters: emptyStudentHistoryFilters,
      studentId,
    })).not.toThrow();
  });

  it("다른 학생·필터와 snapshot 뒤 정렬키를 거절한다", () => {
    const valid = encodeStudentHistoryCursor({
      effectiveAt: "2026-08-28T00:00:00.000Z",
      entryKey: "attempt.example",
      filterFingerprint: studentHistoryFilterFingerprint(
        emptyStudentHistoryFilters,
      ),
      snapshotAt,
      studentId,
      version: 1,
    });
    const cursor = decodeStudentHistoryCursor(valid);
    expect(() => assertStudentHistoryCursorScope(cursor, {
      filters: { ...emptyStudentHistoryFilters, purpose: "review" },
      studentId,
    })).toThrow(StudentHistoryCursorError);
    expect(() => assertStudentHistoryCursorScope(cursor, {
      filters: emptyStudentHistoryFilters,
      studentId: "00000000-0000-4000-8000-000000000002",
    })).toThrow(StudentHistoryCursorError);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T00:00:00.000Z"));
    expect(() => decodeStudentHistoryCursor(encodeStudentHistoryCursor({
      ...cursor,
      effectiveAt: "2026-08-30T00:00:00.000Z",
    }))).toThrow(StudentHistoryCursorError);
    vi.useRealTimers();
  });
});
