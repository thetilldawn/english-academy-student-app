import { describe, expect, it } from "vitest";

import { studentPageTitleForPathname } from "./student-routes";

describe("student route presentation", () => {
  it.each([
    ["/student", "내 시험"],
    ["/student/attempt/attempt-id", "시험"],
    ["/student/result/attempt-id", "시험 결과"],
  ])("maps %s to %s", (pathname, title) => {
    expect(studentPageTitleForPathname(pathname)).toBe(title);
  });
});
