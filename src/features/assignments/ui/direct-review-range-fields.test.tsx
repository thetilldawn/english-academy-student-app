// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectReviewRangeFields, type DirectReviewRangeFieldsProps } from "./direct-review-range-fields";

function props(): DirectReviewRangeFieldsProps {
  return { fieldErrors: {}, onOpenDatasetPicker: vi.fn(), onToggleReviewLevel: vi.fn(), onRetryCalculation: vi.fn(),
    view: { datasetDisabled: false, totalLabel: "미배정 오답 전체 3개", levels: [
      { value: 1, label: "1회 3개", disabled: false, selected: true },
      { value: 2, label: "2회 이상 0개", disabled: true, selected: false },
    ], calculation: { status: "ready", countText: "단어 3개", error: "", retryLabel: "다시 계산하기" } } };
}
afterEach(cleanup);
describe("독립 오답 범위 부품", () => {
  it("작은 표시값과 개별 콜백만으로 선택·찾기·버튼 참조를 연결한다", () => {
    const p = props(); const ref = createRef<HTMLButtonElement>();
    render(<DirectReviewRangeFields {...p} datasetTriggerRef={ref} />);
    const selected = screen.getByRole("button", { name: "1회 3개" });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "2회 이상 0개" })).toBeDisabled();
    fireEvent.click(selected); expect(p.onToggleReviewLevel).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: /단어장을 선택해 주세요/ }));
    expect(p.onOpenDatasetPicker).toHaveBeenCalledTimes(1);
    ref.current?.focus(); expect(ref.current).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("단어 3개");
    expect(screen.getByRole("status")).toHaveAttribute("data-field-key", "questionCount");
  });
  it.each(["다시 불러오기", "다시 계산하기"])("실패시 %s 동작과 오류 초점 위치를 보존한다", (retryLabel) => {
    const p = props(); p.view.calculation = { status: "error", countText: "", error: "오답을 확인하지 못했습니다.", retryLabel };
    p.fieldErrors = { dataset: "단어장을 선택해 주세요.", reviewLevels: "단계를 선택해 주세요.", questionCount: "단어 수를 확인해 주세요." };
    const { container } = render(<DirectReviewRangeFields {...p} />);
    expect(screen.getByText("오답을 확인하지 못했습니다.")).toHaveAttribute("role", "alert");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: retryLabel }));
    expect(p.onRetryCalculation).toHaveBeenCalledTimes(1);
    expect(screen.getByText(p.fieldErrors.reviewLevels!)).toBeInTheDocument();
    expect(screen.getByText(p.fieldErrors.questionCount!)).toBeInTheDocument();
    expect(container.querySelector('[data-field-key="preview"]')).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: /단어장을 선택해 주세요/ })).toHaveAttribute("aria-describedby", "review-dataset-error");
  });
});
