// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VocabQuestionFields, type VocabQuestionFieldsProps } from "./vocab-question-fields";
afterEach(cleanup);
function props(): VocabQuestionFieldsProps {
  return { assignmentMode: "word_count", questionCountMode: "all", selectionMode: "source_order",
    unitsPerSession: 5, overflowPolicy: "leave", fieldErrors: {},
    countView: { countSummary: "단어 수 확인", manualActivationCount: 86, manualCountValue: 86 },
    unitView: { visible: true, showUnitsPerSession: false, showOverflow: false, summary: null },
    onAssignmentModeChange: vi.fn(), onSelectionModeChange: vi.fn(), onUnitsPerSessionChange: vi.fn(),
    onOverflowPolicyChange: vi.fn(), onActivateManualCount: vi.fn(), onManualCountChange: vi.fn(), onSelectAllCount: vi.fn() };
}
it("제어기 없이 모드/수량/선택/전체 동작을 개별 전달한다", () => {
  const p = props(); render(<VocabQuestionFields {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "회차별" }));
  expect(p.onAssignmentModeChange).toHaveBeenCalledWith("per_session");
  const input = screen.getByRole("spinbutton", { name: "회차당 단어 수" });
  fireEvent.focus(input); expect(p.onActivateManualCount).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: "20" } }); expect(p.onManualCountChange).toHaveBeenCalledWith(20);
  fireEvent.click(screen.getByRole("button", { name: "전체" })); expect(p.onSelectAllCount).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "무작위" })); expect(p.onSelectionModeChange).toHaveBeenCalledWith("random");
  expect(input).toHaveAttribute("max", "500"); expect(input).toHaveAttribute("min", "4");
});
it("전체 모드도 관련 오류를 같은 입력에 연결한다", () => {
  const p = props(); p.fieldErrors.questionCount = "한 회차에는 최대 500문항까지 가능합니다.";
  render(<VocabQuestionFields {...p} />);
  expect(screen.getByRole("group", { name: "단어 수" })).toHaveAttribute("aria-describedby", "vocab-question-count-error");
  expect(screen.getByText(p.fieldErrors.questionCount)).toBeInTheDocument();
});
