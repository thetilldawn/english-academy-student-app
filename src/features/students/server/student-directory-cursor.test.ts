// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  assertStudentDirectoryCursorFilters,
  decodeStudentDirectoryCursor,
  encodeStudentDirectoryCursor,
  StudentDirectoryCursorError,
  studentDirectoryFilterFingerprint,
} from "./student-directory-cursor";
import { emptyStudentDirectoryFilters } from "../contracts/student-directory-read-model";

describe("student directory cursor", () => {
  it("snapshot, 정렬 시각, 학생 ID와 필터 지문을 왕복한다", () => {
    const snapshotAt = new Date(Date.now() - 60_000).toISOString();
    const sortAt = new Date(Date.now() - 120_000).toISOString();
    const filters = {
      ...emptyStudentDirectoryFilters,
      query: "고3 김",
      school: "미리보기고",
    };
    const payload = {
      filterFingerprint: studentDirectoryFilterFingerprint(filters),
      snapshotAt,
      sortAt,
      studentId: "00000000-0000-4000-8000-000000000010",
      version: 1 as const,
    };
    const decoded = decodeStudentDirectoryCursor(
      encodeStudentDirectoryCursor(payload),
    );
    expect(decoded).toEqual(payload);
    expect(() => assertStudentDirectoryCursorFilters(decoded, filters))
      .not.toThrow();
  });

  it("다른 필터와 손상된 커서를 거절한다", () => {
    const snapshotAt = new Date(Date.now() - 60_000).toISOString();
    const sortAt = new Date(Date.now() - 120_000).toISOString();
    const payload = {
      filterFingerprint: studentDirectoryFilterFingerprint(
        emptyStudentDirectoryFilters,
      ),
      snapshotAt,
      sortAt,
      studentId: "00000000-0000-4000-8000-000000000010",
      version: 1 as const,
    };
    const decoded = decodeStudentDirectoryCursor(
      encodeStudentDirectoryCursor(payload),
    );
    expect(() =>
      assertStudentDirectoryCursorFilters(decoded, {
        ...emptyStudentDirectoryFilters,
        grade: "고3",
      }),
    ).toThrow(StudentDirectoryCursorError);
    expect(() => decodeStudentDirectoryCursor("not-a-cursor"))
      .toThrow(StudentDirectoryCursorError);
  });
});
