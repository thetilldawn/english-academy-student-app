import { describe, expect, it } from "vitest";

import { buildBulkStudentFilterLabels } from "./bulk-student-selection-summary";

const filters = {
  classGroup: "",
  grade: "",
  query: "",
  school: "",
  status: "active" as const,
  wordbook: "",
  wrongWord: "all" as const,
};

describe("일괄 배정 대상 요약", () => {
  it("선택 학생의 공통값이 아니라 현재 검색·필터를 표시한다", () => {
    expect(buildBulkStudentFilterLabels({
      classGroupLabel: "월수금 A반",
      filters: {
        ...filters,
        classGroup: "group-a",
        query: "김",
        school: "A고",
        wrongWord: "repeated",
      },
      isWholeFilteredSelection: false,
    })).toEqual(["검색: 김", "A고", "월수금 A반", "2회 이상 오답"]);
  });

  it("필터가 없으면 전체 선택과 직접 선택을 구분한다", () => {
    expect(buildBulkStudentFilterLabels({
      classGroupLabel: null,
      filters,
      isWholeFilteredSelection: true,
    })).toEqual(["전체 학생"]);
    expect(buildBulkStudentFilterLabels({
      classGroupLabel: null,
      filters,
      isWholeFilteredSelection: false,
    })).toEqual(["직접 선택"]);
  });
});
