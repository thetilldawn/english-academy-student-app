import { describe, expect, it } from "vitest";

import { directReviewQuestionCountError } from "./direct-review-draft";

describe("direct review question count", () => {
  it.each([1, 2, 3, 4])("오답 %i개를 그대로 독립 시험으로 허용한다", (count) => {
    expect(directReviewQuestionCountError({
      questionCount: count,
      wrongEligible: count,
    })).toBeNull();
  });

  it("0개와 400개 초과를 차단한다", () => {
    expect(directReviewQuestionCountError({
      questionCount: 0,
      wrongEligible: 0,
    })).toBe("오답 없음");
    expect(directReviewQuestionCountError({
      questionCount: 401,
      wrongEligible: 401,
    })).toBe("400개까지");
  });

  it("선택한 오답 수가 바뀌면 차단한다", () => {
    expect(directReviewQuestionCountError({
      questionCount: 2,
      wrongEligible: 1,
    })).toBe("출제 조건 확인");
  });
});
