import { describe, expect, it } from "vitest";

import {
  planNextUnitRange,
  resolveOrderedContiguousUnits,
  resolveOrderedUnitSelection,
  selectInclusiveUnitRange,
} from "@/lib/admin/unit-range";

const units = Array.from({ length: 7 }, (_, index) => ({
  id: `day-${54 + index}`,
  sortIndex: 54 + index,
}));

describe("unit range", () => {
  it("selects an inclusive range in the direction chosen by the teacher", () => {
    expect(
      selectInclusiveUnitRange(units, "day-54", "day-60").map(
        (unit) => unit.id,
      ),
    ).toEqual([
      "day-54", "day-55", "day-56", "day-57", "day-58", "day-59", "day-60",
    ]);
    expect(
      selectInclusiveUnitRange(units, "day-60", "day-54").map(
        (unit) => unit.id,
      ),
    ).toEqual([
      "day-60", "day-59", "day-58", "day-57", "day-56", "day-55", "day-54",
    ]);
  });

  it("preserves either contiguous direction and rejects gaps or duplicates", () => {
    expect(
      resolveOrderedContiguousUnits(units, ["day-60", "day-59", "day-58"])
        .map((unit) => unit.id),
    ).toEqual(["day-60", "day-59", "day-58"]);
    expect(() =>
      resolveOrderedContiguousUnits(units, ["day-60", "day-58"]),
    ).toThrow("연속 범위");
    expect(() =>
      resolveOrderedContiguousUnits(units, ["day-60", "day-59", "day-60"]),
    ).toThrow("올바르지");
  });

  it("공통 배정 선택은 순서를 보존하면서 비연속 단원을 허용한다", () => {
    expect(resolveOrderedUnitSelection(
      units,
      ["day-54", "day-56", "day-60"],
    ).map((unit) => unit.id)).toEqual(["day-54", "day-56", "day-60"]);
    expect(resolveOrderedUnitSelection(
      units,
      ["day-60", "day-56", "day-54"],
    ).map((unit) => unit.id)).toEqual(["day-60", "day-56", "day-54"]);
    expect(() => resolveOrderedUnitSelection(
      units,
      ["day-54", "day-60", "day-56"],
    )).toThrow("순서");
  });

  it("continues with the previous range length and direction", () => {
    const extended = [
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `day-${47 + index}`,
        sortIndex: 47 + index,
      })),
      ...units,
    ];
    expect(
      planNextUnitRange(extended, [
        "day-60", "day-59", "day-58", "day-57", "day-56", "day-55", "day-54",
      ])?.units.map((unit) => unit.id),
    ).toEqual([
      "day-53", "day-52", "day-51", "day-50", "day-49", "day-48", "day-47",
    ]);
  });
});
