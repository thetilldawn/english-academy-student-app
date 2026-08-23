import { describe, expect, it } from "vitest";

import type { AssignmentProgressItem } from "../catalog-types";
import { newAssignmentDraftDefaults } from "./new-assignment-defaults";

function progress(
  overrides: Partial<AssignmentProgressItem["nextAssignmentDefaults"]> = {},
): AssignmentProgressItem {
  return {
    recommendedDatasetId: "dataset-1",
    recommendedUnitId: "unit-7",
    recommendedUnitIds: ["unit-7", "unit-8"],
    recommendationReason: "next",
    nextAssignmentDefaults: {
      availableUntil: "2026-08-12T09:00:00.000Z",
      basisAssignmentId: "assignment-1",
      datasetId: "dataset-1",
      englishToKoreanRatio: 100,
      passingScore: 85,
      questionOrderMode: "descending",
      questionTimeLimitSeconds: 12,
      timeLimitSeconds: 10_800,
      timingMode: "per_question",
      unitIds: ["unit-7", "unit-8"],
      ...overrides,
    },
  } as AssignmentProgressItem;
}

describe("newAssignmentDraftDefaults", () => {
  it("carries the complete next range, per-question timing, and shifted deadline", () => {
    expect(newAssignmentDraftDefaults(progress(), "dataset-1")).toStrictEqual({
      deadline: {
        mode: "at",
        koreanLocalDateTime: "2026-08-12T18:00",
      },
      exam: {
        directionRatio: 100,
        passingScore: 85,
        retryEnabled: true,
        retryPassingScore: 85,
        questionOrderMode: "descending",
        timeLimitEnabled: true,
        timing: { mode: "per_question", perQuestionSeconds: 12 },
      },
      orderedUnitIds: ["unit-7", "unit-8"],
    });
  });

  it("keeps no deadline and safely falls back from invalid inherited timing", () => {
    const result = newAssignmentDraftDefaults(
      progress({
        availableUntil: null,
        questionTimeLimitSeconds: 1,
      }),
      "dataset-1",
    );

    expect(result.deadline).toStrictEqual({ mode: "none" });
    expect(result.exam.timing).toStrictEqual({
      mode: "total",
      totalSeconds: 300,
    });
  });

  it("starts at the first unit when the student has no current wordbook", () => {
    expect(
      newAssignmentDraftDefaults(null, "dataset-2", "dataset-2-unit-1")
        .orderedUnitIds,
    ).toEqual(["dataset-2-unit-1"]);
  });
});
