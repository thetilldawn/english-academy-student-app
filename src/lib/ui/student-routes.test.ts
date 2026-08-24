import { describe, expect, it } from "vitest";

import { studentBreadcrumbForPathname } from "./student-routes";

describe("student route presentation", () => {
  it("uses one shared route title outside the focused quiz", () => {
    expect(studentBreadcrumbForPathname("/student")).toEqual({
      current: "내 단어 시험",
    });
    expect(studentBreadcrumbForPathname("/student/result/result-id")).toEqual({
      section: "내 단어 시험",
      current: "시험 결과",
    });
  });

  it("keeps the focused quiz as the only title exception", () => {
    expect(studentBreadcrumbForPathname("/student/attempt/attempt-id"))
      .toBeNull();
  });
});
