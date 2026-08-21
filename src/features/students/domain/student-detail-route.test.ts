import { describe, expect, it } from "vitest";

import {
  studentDetailBackRoute,
  studentDetailCloseRoute,
  type StudentDetailBaseRoute,
} from "./student-detail-route";

const detail: StudentDetailBaseRoute = {
  kind: "detail",
  studentId: "student-1",
  tab: "info",
};

describe("student detail navigation", () => {
  it("returns a code subview to the recorded student tab", () => {
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
          code: { code: "ABCD-EFGH-IJKL", label: "접속 코드" },
          kind: "code",
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
