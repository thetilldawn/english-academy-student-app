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

  it("시험 조건 뒤에는 일정 화면의 실제 위에서 아래 순서로 이동한다", () => {
    expect(buildVocabAssignmentFieldErrors([
      { code: "out_of_range", path: "commonPlan.unitsPerSession", message: "단위" },
      { code: "out_of_range", path: "commonPlan.questionCount", message: "문항" },
    ]).firstFieldKey).toBe("unitsPerSession");
    expect(buildVocabAssignmentFieldErrors([
      { code: "out_of_range", path: "commonPlan.weekdayUnitsPerSession.3", message: "수요일" },
      { code: "invalid_datetime", path: "commonPlan.schedule.availableTime", message: "공개" },
      { code: "required", path: "commonPlan.schedule.startDate", message: "기준일" },
    ]).firstFieldKey).toBe("weekday-3-units");
  });

  it("서버의 범위 단위 수 계약 오류를 보이는 일정 입력으로 연결한다", () => {
    expect(buildVocabAssignmentFieldErrors([{
      code: "invalid_order",
      path: "commonPlan.rangeUnitCounts",
      message: "단위 수 확인",
    }])).toMatchObject({
      firstFieldKey: "unitAllocationMode",
      errors: { unitAllocationMode: "단위 수 확인" },
    });
  });
});
