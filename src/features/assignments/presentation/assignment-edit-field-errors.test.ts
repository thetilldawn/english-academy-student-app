import { describe, expect, it } from "vitest";

import { assignmentEditFieldErrors } from "./assignment-edit-field-errors";

describe("수정 입력 오류 표시", () => {
  it("검증 경로를 해당 입력의 오류로 한 번씩 연결한다", () => {
    expect(assignmentEditFieldErrors([
      { code: "required", path: "range.orderedUnitIds", message: "범위 필요" },
      { code: "out_of_range", path: "questionCount", message: "단어 수 확인" },
      { code: "out_of_range", path: "exam.passingScore", message: "점수 확인" },
      { code: "invalid_datetime", path: "deadline", message: "마감 확인" },
    ])).toEqual({
      deadline: "마감 확인",
      passingScore: "점수 확인",
      questionCount: "단어 수 확인",
      range: "범위 필요",
    });
  });
});
