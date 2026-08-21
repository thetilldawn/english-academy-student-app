import { describe, expect, it } from "vitest";

import { buildVocabAssignmentFieldErrors } from "./vocab-assignment-field-errors";

describe("buildVocabAssignmentFieldErrors", () => {
  it("서버 배열 순서가 아니라 실제 화면에서 가장 위인 필드를 먼저 고른다", () => {
    const result = buildVocabAssignmentFieldErrors([
      {
        code: "required",
        path: "commonPlan.sessions",
        message: "요일을 선택해 주세요.",
      },
      {
        code: "out_of_range",
        path: "exam.passingScore",
        message: "통과 점수를 확인해 주세요.",
      },
    ]);

    expect(result.firstFieldKey).toBe("passingScore");
    expect(result.blockerReason).toBe("통과 점수를 확인해 주세요.");
  });

  it("회차별 시간 오류는 기본 일정 뒤, 일반 미리보기 오류 앞에서 정렬한다", () => {
    const result = buildVocabAssignmentFieldErrors([
      { code: "required", path: "preview", message: "미리보기 확인" },
      {
        code: "invalid_datetime",
        path: "commonPlan.sessions.1.deadlineLocalDateTime",
        message: "2회차 마감 확인",
      },
      {
        code: "invalid_datetime",
        path: "commonPlan.sessions.0.availableLocalDateTime",
        message: "1회차 공개 확인",
      },
    ]);

    expect(result.firstFieldKey).toBe("session-1-available");
  });
});
