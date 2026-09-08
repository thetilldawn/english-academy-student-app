// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExamTimingFields } from "./exam-timing-fields";

afterEach(cleanup);
const events = () => ({ onEnabledChange: vi.fn(), onModeChange: vi.fn(), onTimingChange: vi.fn() });
describe("독립 시간 입력", () => {
  it("전체 시험 설정 없이 분 값을 표시하고 초로 전달한다", () => {
    const actions = events();
    render(<ExamTimingFields enabled timing={{ mode: "total", totalSeconds: 150 }} {...actions} />);
    const input = screen.getByRole("textbox", { name: "전체 시간(분)" });
    expect(input).toHaveValue("2.5");
    fireEvent.change(input, { target: { value: "3.5" } });
    expect(actions.onTimingChange).toHaveBeenCalledWith({ mode: "total", totalSeconds: 210 });
    fireEvent.click(screen.getByRole("button", { name: "문제당" }));
    expect(actions.onModeChange).toHaveBeenCalledWith("per_question");
  });
  it("문제당 초와 입력 가까운 안전한 오류를 연결한다", () => {
    const actions = events();
    render(<ExamTimingFields enabled timing={{ mode: "per_question", perQuestionSeconds: 20 }}
      error="제한 시간을 확인해 주세요." fieldKey="local-time" {...actions} />);
    const input = screen.getByRole("textbox", { name: /^문제당 시간/ });
    expect(input).toHaveAttribute("aria-errormessage", "local-time-error");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById("local-time-error")).toHaveTextContent("제한 시간을 확인해 주세요.");
    fireEvent.change(input, { target: { value: "30" } });
    expect(actions.onTimingChange).toHaveBeenCalledWith({ mode: "per_question", perQuestionSeconds: 30 });
  });
  it("끄기와 다시 켜기 중 기존 시간 값을 유지하고 필수 입력에서 제외한다", () => {
    const actions = events(); const timing = { mode: "total" as const, totalSeconds: 120 };
    const { rerender } = render(<ExamTimingFields enabled timing={timing} {...actions} />);
    const input = screen.getByRole("textbox", { name: "전체 시간(분)" });
    fireEvent.click(screen.getByRole("checkbox", { name: "사용" }));
    expect(actions.onEnabledChange).toHaveBeenCalledWith(false);
    rerender(<ExamTimingFields enabled={false} timing={timing} {...actions} />);
    expect(input.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(input).not.toBeRequired(); expect(input).toHaveValue("2");
    rerender(<ExamTimingFields enabled timing={timing} {...actions} />);
    expect(input.closest('[aria-hidden="true"]')).toBeNull(); expect(input).toBeRequired();
  });
});
