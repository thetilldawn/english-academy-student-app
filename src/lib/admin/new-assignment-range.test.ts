import { describe, expect, it } from "vitest";

import {
  needsExplicitNewAssignmentRange,
  newAssignmentDefaultUnitId,
  type AssignmentRangeRecommendation,
} from "@/lib/admin/new-assignment-range";

function progress(
  reason: AssignmentRangeRecommendation["recommendationReason"],
): AssignmentRangeRecommendation {
  return {
    recommendedDatasetId: "dataset-1",
    recommendedUnitId: "unit-8",
    recommendationReason: reason,
  };
}

describe("new assignment range defaults", () => {
  it.each(["assigned", "resume", "manual"] as const)(
    "does not reuse a %s range as a new assignment default",
    (reason) => {
      expect(
        newAssignmentDefaultUnitId(progress(reason), "dataset-1"),
      ).toBe("");
      expect(
        needsExplicitNewAssignmentRange(progress(reason), "dataset-1"),
      ).toBe(true);
    },
  );

  it.each(["first", "next", "repeat"] as const)(
    "keeps the safe %s recommendation",
    (reason) => {
      expect(
        newAssignmentDefaultUnitId(progress(reason), "dataset-1"),
      ).toBe("unit-8");
      expect(
        needsExplicitNewAssignmentRange(progress(reason), "dataset-1"),
      ).toBe(false);
    },
  );

  it("ignores recommendations from another wordbook", () => {
    expect(
      newAssignmentDefaultUnitId(progress("next"), "dataset-2"),
    ).toBe("");
  });
});
