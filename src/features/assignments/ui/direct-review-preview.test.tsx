// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DirectReviewPreview } from "./direct-review-preview";

afterEach(cleanup);
it("제어기·학생 원본 없이 제목/값 행만 표시한다", () => {
  const { container } = render(<DirectReviewPreview rows={[{ label: "학생", value: "가짜 학생" },
    { label: "범위", value: "오답 · 1회" }]} />);
  expect(container.querySelectorAll("dt")).toHaveLength(2);
  expect(screen.getByText("가짜 학생")).toBeInTheDocument();
  expect(screen.getByText("오답 · 1회")).toBeInTheDocument();
});
const unavailable = [{ sourceQuestionId: "question", vocabEntryId: 1, headword: "fixture", primaryMeaning: "검사 단어", reason: "direction_unavailable" as const }];
it("shows excluded words and requires an explicit check for the usable remainder", () => {
  const onConfirm = vi.fn();
  render(<DirectReviewPreview rows={[]} diagnosis={{ candidateCount: 3, wrongEligible: 2, unavailableItems: unavailable }} onConfirm={onConfirm} />);
  expect(screen.getByText("선택한 출제 방향의 문제가 없습니다.", { exact: false })).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(onConfirm).toHaveBeenCalledWith(true);
});
it("distinguishes all-unavailable from no wrong words", () => {
  render(<DirectReviewPreview rows={[]} diagnosis={{ candidateCount: 1, wrongEligible: 0, unavailableItems: unavailable }} />);
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.getByText(/현재 조건으로 출제할 수 있는 단어가 없습니다/)).toBeInTheDocument();
  expect(screen.queryByText(/배정할 오답이 없습니다/)).toBeNull();
});
