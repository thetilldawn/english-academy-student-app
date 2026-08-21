import { describe, expect, it } from "vitest";

import {
  bulkPlanSignature,
  type BulkPlanSignatureSource,
} from "./bulk-plan-signature";

function plan(
  overrides: Partial<BulkPlanSignatureSource> = {},
): BulkPlanSignatureSource {
  return {
    datasetId: "dataset-a",
    availableQuestionCount: 40,
    selectedQuestionCount: 20,
    remainingQuestionCount: 20,
    defaultSessionCount: 2,
    scheduledQuestionCount: 40,
    requiresExtraDateDecision: false,
    sessions: [
      {
        availableFrom: "2026-08-24T00:00:00.000Z",
        availableUntil: "2026-08-25T13:00:00.000Z",
        questionCount: 20,
        cycleIndex: 0,
        unitIds: ["unit-a"],
        unitLabel: "DAY 01",
      },
    ],
    ...overrides,
  };
}

describe("bulkPlanSignature", () => {
  it("does not group a same-looking plan from a different dataset", () => {
    expect(bulkPlanSignature(plan())).not.toBe(
      bulkPlanSignature(plan({ datasetId: "dataset-b" })),
    );
  });

  it("does not group a same label backed by different units", () => {
    expect(bulkPlanSignature(plan())).not.toBe(
      bulkPlanSignature(
        plan({
          sessions: [
            {
              ...plan().sessions[0]!,
              unitIds: ["unit-b"],
            },
          ],
        }),
      ),
    );
  });
});
