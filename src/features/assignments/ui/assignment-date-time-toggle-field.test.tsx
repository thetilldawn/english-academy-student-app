// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssignmentDateTimeToggleField } from "./assignment-date-time-toggle-field";

afterEach(cleanup);

function Harness({ memoryKey = "student-a" }: { memoryKey?: string }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <AssignmentDateTimeToggleField
      defaultValue={() => "2026-08-29T10:00"}
      fieldKey="availability"
      id="availability"
      inputLabel="공개"
      memoryKey={memoryKey}
      offText="바로 공개"
      onChange={setValue}
      toggleLabel="공개 시간 사용"
      value={value}
    />
  );
}

describe("assignment date-time toggle field", () => {
  it("reveals, focuses, hides, and restores the entered value", () => {
    render(<Harness />);
    const toggle = screen.getByRole("checkbox", { name: "공개 시간 사용" });
    const input = screen.getByLabelText("공개");

    expect(input.closest("[data-open]")).toHaveAttribute("data-open", "false");
    fireEvent.click(toggle);
    expect(input).toHaveValue("2026-08-29T10:00");
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: "2026-08-30T11:30" } });
    fireEvent.click(toggle);
    expect(input.closest("[data-open]")).toHaveAttribute("data-open", "false");
    fireEvent.click(toggle);
    expect(input).toHaveValue("2026-08-30T11:30");
  });

  it("does not reuse the previous assignment value after the memory key changes", () => {
    const onChange = vi.fn();
    const props = {
      defaultValue: () => "2026-09-01T09:00",
      fieldKey: "deadline",
      id: "deadline",
      inputLabel: "마감",
      offText: "마감 없음",
      onChange,
      toggleLabel: "마감 사용",
    };
    const view = render(
      <AssignmentDateTimeToggleField
        {...props}
        memoryKey="assignment-a"
        value="2026-08-31T18:00"
      />,
    );
    view.rerender(
      <AssignmentDateTimeToggleField
        {...props}
        memoryKey="assignment-b"
        value={null}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "마감 사용" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-09-01T09:00");
  });

  it("connects errors and keeps a series schedule toggle locked", () => {
    render(
      <AssignmentDateTimeToggleField
        defaultValue={() => "2026-09-01T09:00"}
        error="공개 시간을 확인하세요"
        fieldKey="availability"
        id="series-availability"
        inputLabel="공개"
        memoryKey="series-a"
        offText="바로 공개"
        onChange={vi.fn()}
        toggleLabel="공개 시간 사용"
        toggleLocked
        toggleLockedText="배정된 시험 일정"
        value="2026-09-01T09:00"
      />,
    );

    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByLabelText("공개")).toHaveAttribute(
      "aria-errormessage",
      "series-availability-error",
    );
    expect(screen.getByText("배정된 시험 일정")).toBeInTheDocument();
  });
});
