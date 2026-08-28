// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SingleAssignmentController } from "../controller/use-assignment-controller";
import { AssignmentSummaryPanel } from "./assignment-summary-panel";

vi.mock("./assignment-edit-comparison", () => ({
  AssignmentEditComparison: () => <div>변경 비교</div>,
}));

afterEach(cleanup);

function controller(): SingleAssignmentController {
  return {
    issues: [
      {
        code: "out_of_range",
        message: "단어 수를 확인해 주세요.",
        path: "questionCount",
      },
      {
        code: "invalid_order",
        message: "저장 상태를 확인해 주세요.",
        path: "operation.unknown",
      },
    ],
    state: {
      draft: {
        availability: { mode: "immediate" },
        deadline: { mode: "none" },
        exam: {
          passingScore: 80,
          retryEnabled: true,
          retryPassingScore: 80,
          timeLimitEnabled: false,
          timing: { mode: "total", totalSeconds: 300 },
        },
        questionCount: { mode: "manual", value: 20 },
        range: { datasetId: "", orderedUnitIds: [] },
      },
      preview: { status: "ready", value: null },
    },
  } as unknown as SingleAssignmentController;
}

describe("AssignmentSummaryPanel errors", () => {
  it("leaves field errors beside the field and shows only unmapped failures", () => {
    render(
      <AssignmentSummaryPanel
        controller={controller()}
        datasets={[]}
        units={[]}
      />,
    );

    expect(screen.queryByText("단어 수를 확인해 주세요.")).not
      .toBeInTheDocument();
    expect(screen.getByText("저장 상태를 확인해 주세요.")).toBeVisible();
  });

  it("shows a scheduled public time in the final summary", () => {
    const value = controller();
    value.state.draft.availability = {
      mode: "at",
      koreanLocalDateTime: "2026-08-29T10:00",
    };

    render(
      <AssignmentSummaryPanel
        controller={value}
        datasets={[]}
        units={[]}
      />,
    );

    expect(screen.getByText("공개")).toBeVisible();
    expect(screen.getByText(/2026/)).toBeVisible();
  });
});
