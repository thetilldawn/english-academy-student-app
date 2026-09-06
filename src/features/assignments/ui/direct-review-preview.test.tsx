// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DirectReviewPreview } from "./direct-review-preview";

afterEach(cleanup);
it("제어기·학생 원본 없이 제목/값 행만 표시한다", () => {
  const { container } = render(<DirectReviewPreview rows={[{ label: "학생", value: "가짜 학생" },
    { label: "범위", value: "오답 · 1회" }]} />);
  expect(container.querySelectorAll("dt")).toHaveLength(2);
  expect(screen.getByText("가짜 학생")).toBeInTheDocument();
  expect(screen.getByText("오답 · 1회")).toBeInTheDocument();
});
