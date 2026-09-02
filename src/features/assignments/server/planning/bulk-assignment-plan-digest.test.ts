import { describe, expect, it } from "vitest";

import {
  resolvedBulkPlanSha256,
  type ResolvedBulkPlanDigestItem,
  type ResolvedBulkPlanSourceContext,
} from "./bulk-assignment-plan-digest";

const weekdayCounts = {
  1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2,
} as const;

function sourceContext(
  overrides: Partial<ResolvedBulkPlanSourceContext> = {},
): ResolvedBulkPlanSourceContext {
  return {
    distribution: "split",
    splitBasis: "range_unit",
    orderedUnitIds: [
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
    ],
    rangeUnitCounts: [2],
    unitAllocationRule: {
      schemaVersion: 1,
      mode: "same",
      unitsPerSession: 2,
      weekdayUnitsPerSession: weekdayCounts,
    },
    questionCount: { mode: "all" },
    overflowPolicy: "leave",
    extraDatePolicy: "unconfirmed",
    selectedDateCount: 1,
    selectionMode: "source_order",
    recurrenceSessions: [{
      availableFrom: "2026-08-24T00:00:00.000Z",
      availableUntil: "2026-08-24T06:00:00.000Z",
    }],
    ...overrides,
  };
}

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

  it("changes when a canonical item hash or release changes", () => {
    const canonicalPlan = plan({
      targets: [{
        id: 101,
        direction: "korean_to_english",
        questionItemId: "question-1",
        questionItemSha256: "a".repeat(64),
      }],
    });
    const canonicalContext = sourceContext({
      questionMode: "canonical_definition_to_headword",
      canonicalReleaseId: "00000000-0000-4000-8000-000000000005",
      canonicalPackageSha256: "b".repeat(64),
    });
    expect(resolvedBulkPlanSha256(canonicalPlan, canonicalContext)).not.toBe(
      resolvedBulkPlanSha256(
        plan({
          targets: [{
            id: 101,
            direction: "korean_to_english",
            questionItemId: "question-1",
            questionItemSha256: "c".repeat(64),
          }],
        }),
        canonicalContext,
      ),
    );
    expect(resolvedBulkPlanSha256(canonicalPlan, canonicalContext)).not.toBe(
      resolvedBulkPlanSha256(canonicalPlan, {
        ...canonicalContext,
        canonicalReleaseId: "00000000-0000-4000-8000-000000000006",
      }),
    );
  });

  it("changes when the fixed immediate assignment instant changes", () => {
    expect(resolvedBulkPlanSha256(plan())).not.toBe(
      resolvedBulkPlanSha256(plan({
        availableFrom: "2026-08-25T00:00:00.000Z",
      })),
    );
  });

  it("changes when the original unit rule changes despite equal sessions", () => {
    expect(resolvedBulkPlanSha256(plan(), sourceContext())).not.toBe(
      resolvedBulkPlanSha256(plan(), sourceContext({
        unitAllocationRule: {
          schemaVersion: 1,
          mode: "by_weekday",
          unitsPerSession: 2,
          weekdayUnitsPerSession: weekdayCounts,
        },
      })),
    );
  });

  it.each([
    ["overflow policy", { overflowPolicy: "continue_weekly" as const }],
    ["extra-date policy", { extraDatePolicy: "repeat_from_start" as const }],
    ["ordered unit ids", {
      orderedUnitIds: [
        "00000000-0000-4000-8000-000000000004",
        "00000000-0000-4000-8000-000000000003",
      ],
    }],
    ["base unit counts", { rangeUnitCounts: [1, 1] }],
    ["recurrence schedule", {
      recurrenceSessions: [{
        availableFrom: "2026-08-25T00:00:00.000Z",
        availableUntil: "2026-08-25T06:00:00.000Z",
      }],
    }],
  ] satisfies ReadonlyArray<[
    string,
    Partial<ResolvedBulkPlanSourceContext>,
  ]>)("changes when only the source %s changes", (_label, override) => {
    expect(resolvedBulkPlanSha256(plan(), sourceContext())).not.toBe(
      resolvedBulkPlanSha256(plan(), sourceContext(override)),
    );
  });
});
