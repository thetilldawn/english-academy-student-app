import { describe, expect, it } from "vitest";

import {
  resolveBulkAssignmentRange,
  unitRangeLabel,
} from "@/lib/admin/bulk-assignment-range";

const units = Array.from({ length: 60 }, (_, index) => ({
  id: `day-${index + 1}`,
  label: `DAY ${String(index + 1).padStart(2, "0")}`,
  sortIndex: index + 1,
}));

describe("일괄 배정 범위", () => {
  it("다음 한 DAY만 고를 수 있다", () => {
    const range = resolveBulkAssignmentRange(
      units,
      { recommendedUnitIds: ["day-43", "day-44"], recommendedDirection: 1 },
      "single",
    );

    expect(range.units.map((unit) => unit.id)).toEqual(["day-43"]);
    expect(range.truncated).toBe(false);
  });

  it("이전 배정의 범위 길이와 역방향을 유지한다", () => {
    const range = resolveBulkAssignmentRange(
      units,
      {
        recommendedUnitIds: [
          "day-53",
          "day-52",
          "day-51",
          "day-50",
          "day-49",
          "day-48",
          "day-47",
        ],
        recommendedDirection: -1,
      },
      "previous_span",
    );

    expect(range.units.map((unit) => unit.id)).toEqual([
      "day-53",
      "day-52",
      "day-51",
      "day-50",
      "day-49",
      "day-48",
      "day-47",
    ]);
    expect(unitRangeLabel(range.units)).toBe("DAY 53~DAY 47");
  });

  it("일주일치는 현재 방향으로 최대 7 DAY를 한 시험에 묶는다", () => {
    const range = resolveBulkAssignmentRange(
      units,
      { recommendedUnitIds: ["day-5"], recommendedDirection: 1 },
      "week_span",
    );

    expect(range.units.map((unit) => unit.id)).toEqual([
      "day-5",
      "day-6",
      "day-7",
      "day-8",
      "day-9",
      "day-10",
      "day-11",
    ]);
  });

  it("단어장 끝에서는 남은 DAY까지만 줄인다", () => {
    const range = resolveBulkAssignmentRange(
      units,
      { recommendedUnitIds: ["day-58"], recommendedDirection: 1 },
      "week_span",
    );

    expect(range.units.map((unit) => unit.id)).toEqual([
      "day-58",
      "day-59",
      "day-60",
    ]);
    expect(range.truncated).toBe(true);
  });
});
