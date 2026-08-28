// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { SingleAssignmentController } from "../controller/use-assignment-controller";
import type { SingleAssignmentDraft } from "../domain/model";
import { AssignmentEditComparison } from "./assignment-edit-comparison";

afterEach(cleanup);

const baseline: SingleAssignmentDraft = {
  kind: "single",
  operation: {
    mode: "replace",
    assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    targetStudentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    sourcePurpose: "regular",
    seriesItem: false,
  },
  studentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  title: { mode: "source", value: "기존 시험" },
  range: {
    datasetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    orderedUnitIds: [],
  },
  questionCount: { mode: "manual", value: 20 },
  exam: {
    directionRatio: 50,
    passingScore: 80,
    questionOrderMode: "random",
    retryEnabled: true,
    retryPassingScore: 80,
    timeLimitEnabled: true,
    timing: { mode: "total", totalSeconds: 300 },
  },
  availability: { mode: "immediate" },
  deadline: { mode: "none" },
  review: { mode: "none", scope: "dataset", levels: [1, 2] },
};

describe("assignment edit comparison", () => {
  it("counts and displays a public-time change", () => {
    const current: SingleAssignmentDraft = {
      ...baseline,
      availability: {
        mode: "at",
        koreanLocalDateTime: "2026-08-29T10:00",
      },
    };
    const controller = {
      baselineDraft: baseline,
      state: { draft: current },
    } as SingleAssignmentController;

    render(
      <AssignmentEditComparison
        controller={controller}
        datasets={[]}
        units={[]}
      />,
    );

    expect(screen.getByText("바로 공개")).toBeVisible();
    expect(screen.getByText(/2026/)).toBeVisible();
  });
});
