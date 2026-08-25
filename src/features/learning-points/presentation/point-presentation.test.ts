import { describe, expect, it } from "vitest";

import {
  formatPointChange,
  formatVisiblePoints,
} from "./point-presentation";

describe("point presentation", () => {
  it("clamps visible balances and formats large values", () => {
    expect(formatVisiblePoints(-12)).toBe("0");
    expect(formatVisiblePoints(1234567)).toBe("1,234,567");
    expect(formatVisiblePoints(Number.NaN)).toBe("0");
  });

  it("keeps the sign for an admin change", () => {
    expect(formatPointChange(2)).toBe("+2");
    expect(formatPointChange(-3)).toBe("-3");
    expect(formatPointChange(0)).toBe("0");
  });
});
