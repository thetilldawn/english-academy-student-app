import { describe, expect, it } from "vitest";

import {
  resolvedBulkPlanSha256,
  type ResolvedBulkPlanDigestItem,
} from "./bulk-assignment-plan-digest";

function plan(
  overrides: Partial<ResolvedBulkPlanDigestItem["sessions"][number]> = {},
): ResolvedBulkPlanDigestItem[] {
  return [{
    studentId: "00000000-0000-4000-8000-000000000001",
    datasetId: "00000000-0000-4000-8000-000000000002",
    sessions: [{
      sessionNumber: 1,
      sourceSessionNumber: 1,
      cycleIndex: 0,
      unitIds: ["00000000-0000-4000-8000-000000000003"],
      questionCount: 1,
      availableFrom: "2026-08-24T00:00:00.000Z",
      availableUntil: null,
      allowedCollisionAssignmentIds: [],
      targets: [{ id: 101, direction: "english_to_korean" }],
      ...overrides,
    }],
  }];
}

describe("resolved bulk plan digest", () => {
  it("is stable for the same resolved plan", () => {
    expect(resolvedBulkPlanSha256(plan())).toBe(
      resolvedBulkPlanSha256(plan()),
    );
  });

  it("changes when a target changes even if the question count stays equal", () => {
    expect(resolvedBulkPlanSha256(plan())).not.toBe(
      resolvedBulkPlanSha256(plan({
        targets: [{ id: 102, direction: "english_to_korean" }],
      })),
    );
  });

  it("changes when only the target direction changes", () => {
    expect(resolvedBulkPlanSha256(plan())).not.toBe(
      resolvedBulkPlanSha256(plan({
        targets: [{ id: 101, direction: "korean_to_english" }],
      })),
    );
  });

  it("changes when the fixed immediate assignment instant changes", () => {
    expect(resolvedBulkPlanSha256(plan())).not.toBe(
      resolvedBulkPlanSha256(plan({
        availableFrom: "2026-08-25T00:00:00.000Z",
      })),
    );
  });
});
