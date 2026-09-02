import { describe, expect, it } from "vitest";

import { normalizeQuizContentMode } from "./question-content-mode";

describe("normalizeQuizContentMode", () => {
  it("기존 교재 시험 값을 현재 값으로 변환한다", () => {
    expect(normalizeQuizContentMode("legacy_book_meaning_choice")).toBe(
      "book_meaning_choice",
    );
  });

  it("알 수 없는 문제 유형을 교재 뜻 시험으로 조용히 바꾸지 않는다", () => {
    expect(() => normalizeQuizContentMode("unknown_mode")).toThrow(
      "지원하지 않는 시험 문제 유형입니다.",
    );
  });
});
