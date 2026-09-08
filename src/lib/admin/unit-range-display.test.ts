import { describe, expect, it } from "vitest";
import { unitRangeDisplayGroups, unitRangeDisplayLabel } from "./unit-range-display";

describe("unit range display", () => {
  it.each([
    [["DAY 01", "DAY 02", "DAY 03"], "DAY 01~DAY 03"],
    [["DAY 03", "DAY 02", "DAY 01"], "DAY 03~DAY 01"],
    [["DAY 01", "DAY 03"], "DAY 01 · DAY 03"],
    [["DAY 01", "DAY 01", "DAY 02"], "DAY 01 · DAY 01~DAY 02"],
    [["공통영어 II 1과", "공통영어 II 2과"], "공통영어 II 1과~공통영어 II 2과"],
    [["공통영어 I 1과", "공통영어 II 2과"], "공통영어 I 1과 · 공통영어 II 2과"],
    [["2025-03 서울교육청 41-42", "2025-11 대수능 43-45"], "2025-03 서울교육청 41-42 · 2025-11 대수능 43-45"],
  ])("keeps exact source units %j", (labels, expected) => {
    expect(unitRangeDisplayLabel(labels)).toBe(expected);
    expect(unitRangeDisplayGroups(labels).flatMap(group => group.unitLabels)).toEqual(labels);
  });
  it("keeps all fourteen unknown exam ranges without altering counts or the input", () => {
    const labels = Object.freeze(Array.from({ length: 14 }, (_, i) => `2025-${i + 1} 모의고사 41-45`));
    expect(unitRangeDisplayGroups(labels)).toHaveLength(14);
    expect(unitRangeDisplayGroups(labels).flatMap(group => group.unitLabels)).toEqual(labels);
    expect(unitRangeDisplayLabel([])).toBeNull();
  });
});
