// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VocabUnitAllocationFields } from "./vocab-unit-allocation-fields";
afterEach(cleanup);
it("단위 입력과 남은 범위 동작은 좁은 값/콜백만 받는다", () => {
  const units = vi.fn(), overflow = vi.fn();
  render(<VocabUnitAllocationFields unitsPerSession={5} overflowPolicy="leave"
    view={{ visible: true, showUnitsPerSession: true, showOverflow: true, summary: "기본 5회" }}
    fieldErrors={{ unitsPerSession: "단위 수를 확인해 주세요.", overflowPolicy: "남은 범위 처리 방법을 선택해 주세요." }}
    onUnitsPerSessionChange={units} onOverflowPolicyChange={overflow} />);
  const input = screen.getByRole("spinbutton", { name: /^회차당 단위 수/ });
  expect(input).toHaveValue(5); expect(input).toHaveAttribute("aria-errormessage", "vocab-units-per-session-error");
  fireEvent.change(input, { target: { value: "3" } }); expect(units).toHaveBeenCalledWith(3);
  fireEvent.click(screen.getByRole("button", { name: "같은 요일로 이어서" })); expect(overflow).toHaveBeenCalledWith("continue_weekly");
  expect(screen.getByRole("group", { name: "남은 범위" })).toHaveAttribute("aria-describedby", "vocab-overflow-policy-error");
  expect(screen.queryByText("요일별 단위 수")).not.toBeInTheDocument();
});
