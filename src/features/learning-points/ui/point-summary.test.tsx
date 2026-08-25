/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AdminAttemptPointSummaryView,
  CurrentPointSummary,
  StudentAttemptPointSummaryView,
} from "./point-summary";

describe("point summaries", () => {
  it("shows a non-negative current balance", () => {
    render(<CurrentPointSummary currentPoints={-7} />);
    const summary = screen.getByLabelText("현재 포인트");
    expect(summary).toHaveTextContent("0");
  });

  it("shows the student attempt and current values without signs", () => {
    render(
      <StudentAttemptPointSummaryView
        summary={{ attemptPoints: 2, currentPoints: 14 }}
      />,
    );
    const summary = screen.getByLabelText("시험 포인트");
    expect([...summary.children].every((child) => child.tagName === "DIV"))
      .toBe(true);
    expect(within(summary).getByText("이번 시험 포인트")).toBeVisible();
    expect(within(summary).getByText("현재 포인트")).toBeVisible();
    expect(summary).toHaveTextContent("2");
    expect(summary).toHaveTextContent("14");
    expect(summary).not.toHaveTextContent("+2");
  });

  it("preserves the signed admin breakdown", () => {
    render(
      <AdminAttemptPointSummaryView
        summary={{
          correctReward: 2,
          wrongEffect: -3,
          netChange: -1,
          currentPoints: 0,
        }}
      />,
    );
    const summary = screen.getByLabelText("포인트 반영 내역");
    expect(summary).toHaveTextContent("+2");
    expect(summary).toHaveTextContent("-3");
    expect(summary).toHaveTextContent("-1");
    expect(within(summary).getByText("현재 포인트")).toBeVisible();
  });
});
