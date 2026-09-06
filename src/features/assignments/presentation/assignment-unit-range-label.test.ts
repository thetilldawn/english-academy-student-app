import { describe, expect, it } from "vitest";

import { assignmentRangeSelectionSummary, assignmentSourceWordCount, assignmentUnitRangeLabel } from "./assignment-unit-range-label";

describe("assignmentUnitRangeLabel", () => {
  it("수록 합계는 순서/원본을 바꾸지 않고 출제 가능 수로 둔갑시키지 않는다", () => {
    const units = Object.freeze([{ entryCount: 40 }, { entryCount: 80 }]);
    expect(assignmentSourceWordCount(units)).toBe(120);
    expect(assignmentRangeSelectionSummary(units)).toBe("선택한 범위 2개 · 수록 단어 120개");
    expect(assignmentRangeSelectionSummary([])).toBe("시험 범위를 선택해 주세요.");
    expect(assignmentRangeSelectionSummary([{ entryCount: 0 }])).toBe("선택한 범위 1개 · 수록 단어 0개");
    expect(units.map(unit => unit.entryCount)).toEqual([40, 80]);
  });
  it("shows continuous selections as a first-to-last range", () => {
    expect(
      assignmentUnitRangeLabel(["DAY 01", "DAY 02"], [1, 2]),
    ).toBe("DAY 01~DAY 02");
    expect(
      assignmentUnitRangeLabel(["DAY 03", "DAY 02"], [3, 2]),
    ).toBe("DAY 03~DAY 02");
  });

  it("shows separated selections as an exact selected count", () => {
    expect(
      assignmentUnitRangeLabel(["DAY 01", "DAY 03"], [1, 3]),
    ).toBe("DAY 01 외 1개");
  });
});
