import { describe, expect, it } from "vitest";

import { assignmentUnitRangeLabel } from "./assignment-unit-range-label";

describe("assignmentUnitRangeLabel", () => {
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
