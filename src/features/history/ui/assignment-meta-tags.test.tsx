/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AssignmentMetaTags } from "./assignment-meta-tags";

afterEach(cleanup);

describe("AssignmentMetaTags", () => {
  it("shows only the wordbook and range for a regular exam", () => {
    render(
      <AssignmentMetaTags
        assignmentPurpose="regular"
        datasetTitle="능률 VOCA"
        primaryUnitLabels={["DAY 01", "DAY 02"]}
        questionCount={20}
        unitLabels={["DAY 01", "DAY 02"]}
      />,
    );

    expect(screen.getByText("능률 VOCA")).toBeVisible();
    expect(screen.getByText("DAY 01~DAY 02")).toBeVisible();
    expect(screen.queryByText("단어 시험")).not.toBeInTheDocument();
    expect(screen.queryByText("20문항")).not.toBeInTheDocument();
  });

  it("keeps the review meaning inside its single scope label", () => {
    render(
      <AssignmentMetaTags
        assignmentPurpose="review"
        datasetTitle="능률 VOCA"
        primaryUnitLabels={[]}
        questionCount={3}
        unitLabels={["DAY 01"]}
      />,
    );

    expect(screen.getByText("오답 시험 · 3문항")).toBeVisible();
    expect(screen.queryByText("오답 시험")).not.toBeInTheDocument();
    expect(screen.queryByText("3문항")).not.toBeInTheDocument();
  });
});
