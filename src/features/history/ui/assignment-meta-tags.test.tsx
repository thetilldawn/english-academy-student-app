/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AssignmentMetaTags } from "./assignment-meta-tags";

afterEach(cleanup);

describe("AssignmentMetaTags", () => {
  it("uses one outlined wordbook tag without removing punctuation inside the title or range", () => {
    render(<AssignmentMetaTags assignmentPurpose="regular" datasetAppearance="badge"
      datasetTitle="능률 VOCA 어원편 고등 · 2025개정"
      primaryUnitLabels={["DAY 17", "DAY 18", "DAY 19", "DAY 20"]}
      unitLabels={["DAY 17", "DAY 18", "DAY 19", "DAY 20"]} questionCount={100} />);
    const group = screen.getByRole("group", { name: "단어장과 범위" });
    expect(group).toHaveAttribute("data-dataset-appearance", "badge");
    expect(screen.getByText("능률 VOCA 어원편 고등 · 2025개정")).toHaveAttribute("data-tone", "neutral");
    expect(screen.getByText("DAY 17~DAY 20")).not.toHaveAttribute("data-tone");
    expect(group.querySelectorAll('[data-tone]')).toHaveLength(1);
    expect(group.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(group.querySelector("a,button")).toBeNull();
  });

  it("does not convert compact detail text into a badge unless explicitly requested", () => {
    render(<AssignmentMetaTags compact assignmentPurpose="regular" datasetTitle="능률 VOCA"
      primaryUnitLabels={["DAY 01"]} unitLabels={["DAY 01"]} questionCount={20} />);
    const group = screen.getByRole("group", { name: "단어장과 범위" });
    expect(group).toHaveAttribute("data-dataset-appearance", "text");
    expect(group.querySelector('[aria-hidden="true"]')).toHaveTextContent("·");
    expect(group.querySelector("[data-tone]")).toBeNull();
  });

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
    expect(screen.getByRole("group", { name: "단어장과 범위" })).toBeVisible();
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

    expect(screen.getByText("오답 시험 · 단어 3개")).toBeVisible();
    expect(screen.queryByText("오답 시험")).not.toBeInTheDocument();
    expect(screen.queryByText("3문항")).not.toBeInTheDocument();
  });
});
