import { describe, expect, it } from "vitest";

import {
  assignmentEditChangeKeys,
  assignmentEditFieldPolicy,
  lockedAssignmentEditChangeKeys,
  type AssignmentEditComparable,
} from "./assignment-edit-policy";

const before: AssignmentEditComparable = {
  title: "기존 시험",
  datasetId: "dataset-a",
  primaryUnitIds: ["unit-a"],
  questionCount: 20,
  englishToKoreanRatio: 50,
  timeLimitSeconds: 300,
  timingMode: "total",
  questionTimeLimitSeconds: null,
  passingScore: 80,
  retryEnabled: true,
  retryPassingScore: 80,
  questionOrderMode: "random",
  availableFrom: null,
  availableUntil: null,
  includePendingReview: false,
  reviewScope: "dataset",
  reviewLevels: [1, 2],
};

describe("assignment edit field policy", () => {
  it("keeps one explicit matrix for regular, mixed, and review edits", () => {
    expect(assignmentEditFieldPolicy("regular")).toMatchObject({
      title: "ui_hidden",
      dataset: "editable",
      range: "editable",
      questionCount: "editable",
      direction: "editable",
      order: "editable",
      timing: "editable",
      passingScore: "editable",
      retry: "editable",
      availableFrom: "editable",
      deadline: "editable",
      review: "locked",
    });
    expect(assignmentEditFieldPolicy("mixed")).toMatchObject({
      dataset: "locked",
      range: "locked",
      questionCount: "locked",
      direction: "locked",
      order: "editable",
      timing: "editable",
    });
    expect(assignmentEditFieldPolicy("review")).toMatchObject({
      dataset: "locked",
      range: "locked",
      questionCount: "locked",
      direction: "locked",
      order: "editable",
    });
  });

  it("ignores hidden review scope and levels while review is off", () => {
    const after = {
      ...before,
      reviewScope: "selection" as const,
      reviewLevels: [2],
    };

    expect(assignmentEditChangeKeys(before, after)).not.toContain("review");
  });

  it("treats review levels as a set while review is enabled", () => {
    const enabled = {
      ...before,
      includePendingReview: true,
    };

    expect(
      assignmentEditChangeKeys(enabled, {
        ...enabled,
        reviewLevels: [2, 1],
      }),
    ).not.toContain("review");
  });

  it("reports only changes locked for the source assignment purpose", () => {
    const after = {
      ...before,
      primaryUnitIds: ["unit-b"],
      questionCount: 10,
      englishToKoreanRatio: 100,
      availableFrom: "2026-08-29T00:00:00.000Z",
    };

    expect(lockedAssignmentEditChangeKeys("regular", before, after)).toEqual(
      [],
    );
    expect(lockedAssignmentEditChangeKeys("mixed", before, after)).toEqual([
      "range",
      "questionCount",
      "direction",
    ]);
    expect(lockedAssignmentEditChangeKeys("review", before, after)).toEqual([
      "range",
      "questionCount",
      "direction",
    ]);
  });

  it("locks only the dataset for a regular assignment that belongs to a series", () => {
    expect(
      assignmentEditFieldPolicy("regular", { seriesItem: true }),
    ).toMatchObject({
      dataset: "locked",
      range: "editable",
      questionCount: "editable",
      availableFrom: "editable",
      deadline: "editable",
    });
  });
});
