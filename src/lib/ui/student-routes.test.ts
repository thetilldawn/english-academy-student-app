import { describe, expect, it } from "vitest";

import { studentPageTitleForPathname } from "./student-routes";

describe("student route presentation", () => {
  it("keeps an accessible page title outside the focused quiz", () => {
    expect(studentPageTitleForPathname("/student")).toBe("내 단어 시험");
    expect(studentPageTitleForPathname("/student/result/result-id"))
      .toBe("시험 결과");
  });

  it("keeps the focused quiz as the only title exception", () => {
    expect(studentPageTitleForPathname("/student/attempt/attempt-id"))
      .toBeNull();
  });
});
