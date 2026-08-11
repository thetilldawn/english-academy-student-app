import { describe, expect, it } from "vitest";

import {
  studentDetailBackRoute,
  studentDetailCloseRoute,
  type StudentDetailBaseRoute,
} from "./student-detail-route";

const detail: StudentDetailBaseRoute = {
  kind: "detail",
  learningView: "summary",
  studentId: "student-1",
  tab: "learning",
};

describe("student detail navigation", () => {
  it("returns from a learning source to the same student's learning tab", () => {
    expect(
      studentDetailBackRoute({
        datasetId: "dataset-1",
        kind: "source",
        label: "아주 긴 단어장 이름".repeat(8),
        studentId: "student-1",
        view: "vocab",
      }),
    ).toEqual(detail);
  });

  it("returns assignment and code subviews to their recorded parent", () => {
    expect(
      studentDetailBackRoute({
        datasetId: "dataset-1",
        kind: "assignment",
        returnTo: detail,
        studentId: "student-1",
      }),
    ).toEqual(detail);
    expect(
      studentDetailBackRoute({
        code: { code: "ABCD-EFGH-IJKL", label: "접속 코드" },
        kind: "code",
        returnTo: detail,
        studentId: "student-1",
      }),
    ).toEqual(detail);
  });

  it("closes the full dialog only for the explicit close button", () => {
    expect(studentDetailCloseRoute(detail, "close-button")).toEqual({
      kind: "closed",
    });
    expect(
      studentDetailCloseRoute(
        {
          datasetId: "dataset-1",
          kind: "assignment",
          returnTo: detail,
          studentId: "student-1",
        },
        "escape",
      ),
    ).toEqual(detail);
  });

  it("closes a standalone newly-created code screen on back", () => {
    expect(
      studentDetailBackRoute({
        code: { code: "ABCD-EFGH-IJKL", label: "새 학생 코드" },
        kind: "code",
        returnTo: null,
        studentId: null,
      }),
    ).toEqual({ kind: "closed" });
  });
});
