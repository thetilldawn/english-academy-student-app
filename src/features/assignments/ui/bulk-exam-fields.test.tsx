// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BulkExamFields, type BulkExamFieldsProps } from "./bulk-exam-fields";
import { installNativeOverlayFixture } from "@/test-support/native-overlay-fixture";
installNativeOverlayFixture();
import { assignmentQuestionModes, type AssignmentQuestionMode } from "../domain/model";
import { assignmentQuestionModePolicy } from "../domain/assignment-question-mode-policy";
import { assignmentQuestionModeView } from "../presentation/assignment-question-mode-view";

afterEach(cleanup);
function props(mode: AssignmentQuestionMode = "book_meaning_choice", availableModes: readonly AssignmentQuestionMode[] | undefined = assignmentQuestionModes, datasetSelected = true): BulkExamFieldsProps {
  return {
    questionMode: assignmentQuestionModeView({ questionMode: mode, availableModes, datasetSelected }),
    questionOrder: "sequential", exam: { directionRatio: mode === "book_meaning_choice" ? 50 : mode === "canonical_headword_to_definition" ? 100 : 0, passingScore: 80, retryEnabled: false },
    directionDisabled: assignmentQuestionModePolicy(mode).fixedDirectionRatio !== null,
    onQuestionModeChange: vi.fn(), onQuestionOrderChange: vi.fn(), onDirectionChange: vi.fn(),
    onPassingScoreChange: vi.fn(), onRetryEnabledChange: vi.fn(), onRetryPassingScoreChange: vi.fn(),
  };
}
describe("BulkExamFields with explicit inputs", () => {
  it("shows four content modes and forwards selection without a controller", () => {
    const input = props(); render(<BulkExamFields {...input} />);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    fireEvent.click(screen.getByRole("tab", { name: "예문 → 영어" }));
    expect(input.onQuestionModeChange).toHaveBeenCalledWith("canonical_example_to_headword");
  });
  it("keeps unavailable modes disabled with an associated reason", () => {
    const input = props("book_meaning_choice", ["book_meaning_choice", "canonical_definition_to_headword"]);
    render(<BulkExamFields {...input} />);
    const tab = screen.getByRole("tab", { name: "예문 → 영어" });
    expect(tab).toHaveAttribute("aria-disabled", "true");
    const reason = screen.getByText(/배정 가능한 예문 문항이 없습니다/);
    expect(reason).not.toHaveAttribute("data-popover-open");
    fireEvent.mouseEnter(tab);
    expect(reason).toHaveAttribute("data-popover-open");
    fireEvent.focus(tab);
    expect(tab.getAttribute("aria-describedby")).toContain(reason.id);
    expect(screen.getByRole("tab", { name: "영영풀이 → 영어" })).toBeEnabled();
    fireEvent.click(tab); expect(input.onQuestionModeChange).not.toHaveBeenCalled();
    fireEvent.keyDown(tab, { key: "ArrowLeft" });
    expect(input.onQuestionModeChange).toHaveBeenCalledWith("canonical_definition_to_headword");
    expect(screen.queryByText(/검토 중/)).not.toBeInTheDocument();
  });
  it.each(assignmentQuestionModes.slice(1))("keeps direction locked for %s", mode => {
    render(<BulkExamFields {...props(mode)} />);
    for (const name of ["영어 → 뜻", "뜻 → 영어", "혼합"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    if (mode === "canonical_example_to_headword") {
      expect(screen.getByRole("status")).toHaveTextContent("영어 선택지 4개");
      expect(screen.getByRole("status")).toHaveTextContent("시험일 없이 1회 배정");
    } else {
      expect(screen.queryByRole("status")).toBeNull();
      const fixed = mode === "canonical_headword_to_definition" ? "영어 → 뜻" : "뜻 → 영어";
      expect(screen.getByRole("button", { name: fixed })).toHaveAttribute("aria-pressed", "true");
    }
  });
  it("keeps unselected separate from empty", () => {
    render(<BulkExamFields {...props("book_meaning_choice", assignmentQuestionModes, false)} />);
    expect(screen.getByText(/단어장을 먼저 선택하면/)).toBeVisible();
    expect(screen.getByRole("tab", { name: "예문 → 영어" })).toHaveAttribute("aria-describedby", "question-mode-dataset-required");
    expect(screen.queryByText(/검토 중|문항이 없습니다/)).not.toBeInTheDocument();
  });
  it("shows missing information and recovers after current preparation arrives", () => {
    const input = props();
    input.questionMode = assignmentQuestionModeView({ questionMode: "book_meaning_choice", datasetSelected: true });
    const { rerender } = render(<BulkExamFields {...input} />);
    expect(screen.getByRole("alert")).toHaveTextContent("출제 유형 정보를 확인하지 못했습니다");
    expect(screen.queryByText(/문항이 없습니다|검토 중/)).not.toBeInTheDocument();
    rerender(<BulkExamFields {...props()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "예문 → 영어" })).toBeEnabled();
  });
  it("connects score, order, direction, retry, and field errors individually", () => {
    const input = props();
    input.fieldErrors = { passingScore: "통과 점수를 확인해 주세요.", questionOrder: "문제 순서를 선택해 주세요." };
    render(<BulkExamFields {...input} />);
    const score = screen.getByRole("textbox", { name: "통과 점수" });
    expect(score).toHaveAttribute("aria-errormessage", "bulk-passing-score-error");
    fireEvent.change(score, { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "무작위" }));
    fireEvent.click(screen.getByRole("button", { name: "뜻 → 영어" }));
    fireEvent.click(screen.getByRole("checkbox"));
    expect(input.onPassingScoreChange).toHaveBeenCalledWith(90);
    expect(input.onQuestionOrderChange).toHaveBeenCalledWith("random");
    expect(input.onDirectionChange).toHaveBeenCalledWith(0);
    expect(input.onRetryEnabledChange).toHaveBeenCalledWith(true);
    expect(screen.getByText("문제 순서를 선택해 주세요.")).toBeVisible();
  });
});
