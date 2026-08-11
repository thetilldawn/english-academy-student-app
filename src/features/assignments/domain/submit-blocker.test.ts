import { describe, expect, it } from "vitest";

import { deriveSingleAssignmentSubmitBlocker } from "./submit-blocker";

const readyCapacity = {
  maximumQuestionCount: 20,
  minimumQuestionCount: 4,
  wrongEligible: 3,
};

function derive(
  overrides: Partial<Parameters<typeof deriveSingleAssignmentSubmitBlocker>[0]> = {},
) {
  return deriveSingleAssignmentSubmitBlocker({
    capacity: readyCapacity,
    capacityReadyForCurrentDraft: true,
    dirty: true,
    issues: [],
    loadStatus: "ready",
    minimumQuestionCount: 4,
    previewStatus: "ready",
    questionCount: 10,
    reviewMode: "none",
    submissionStatus: "idle",
    ...overrides,
  });
}

describe("single assignment submit blocker", () => {
  it("keeps the enabled state and blocker reason derived from one decision", () => {
    expect(derive()).toBeNull();
    expect(derive({ loadStatus: "loading" })).toEqual({ code: "loading" });
    expect(derive({ dirty: false })).toEqual({ code: "unchanged" });
    expect(derive({ previewStatus: "error" })).toEqual({
      code: "capacity_failed",
    });
    expect(
      derive({ capacityReadyForCurrentDraft: false, previewStatus: "ready" }),
    ).toEqual({ code: "capacity_loading" });
  });

  it("reports the exact capacity condition that blocks submission", () => {
    expect(
      derive({
        capacity: { ...readyCapacity, maximumQuestionCount: 3 },
      }),
    ).toEqual({ code: "range_unavailable" });
    expect(derive({ questionCount: 3 })).toEqual({
      code: "question_count_too_low",
    });
    expect(derive({ questionCount: 21 })).toEqual({
      code: "question_count_too_high",
    });
    expect(
      derive({
        capacity: { ...readyCapacity, wrongEligible: 0 },
        reviewMode: "pending",
      }),
    ).toEqual({ code: "no_review_words" });
  });

  it("prioritizes validation before the asynchronous capacity check", () => {
    expect(
      derive({
        issues: [
          { code: "required", message: "범위가 필요합니다.", path: "range.orderedUnitIds" },
        ],
        previewStatus: "loading",
      }),
    ).toEqual({ code: "invalid", path: "range.orderedUnitIds" });
  });
});
