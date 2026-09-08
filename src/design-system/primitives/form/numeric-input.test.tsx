// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NumericInput } from "./numeric-input";

afterEach(cleanup);

function Editor({ decimal = false }: { decimal?: boolean }) {
  const [value, setValue] = useState(80);
  return <NumericInput aria-label="수량" decimal={decimal} onValueChange={(next) => setValue(next ?? Number.NaN)} required value={value} />;
}

describe("NumericInput", () => {
  it("keeps an empty draft and strips leading zeros on completion", async () => {
    const user = userEvent.setup();
    render(<Editor />);
    const input = screen.getByRole("textbox", { name: "수량" });
    await user.clear(input);
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("숫자를 입력해 주세요.");
    await user.type(input, "001");
    expect(input).toHaveValue("001");
    await user.tab();
    expect(input).toHaveValue("1");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("distinguishes zero, half a minute, unfinished decimals and invalid text", () => {
    const change = vi.fn();
    render(<NumericInput aria-label="시간" decimal onValueChange={change} value={1} />);
    const input = screen.getByRole("textbox");
    for (const [raw, expected] of [["0", 0], ["0.5", 0.5], [".", null], ["1.", null], ["NaN", null], ["Infinity", null], ["", null]] as const) {
      fireEvent.change(input, { target: { value: raw } });
      expect(change).toHaveBeenLastCalledWith(expected);
    }
    fireEvent.change(input, { target: { value: "1." } });
    fireEvent.blur(input);
    expect(input).toHaveValue("1");
    expect(change).toHaveBeenLastCalledWith(1);
  });

  it("does not step numbers on wheel, touch scrolling or arrow keys", () => {
    const change = vi.fn();
    render(<NumericInput aria-label="수량" onValueChange={change} value={20} />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.wheel(input, { deltaY: 100 });
    fireEvent.touchMove(input, { touches: [{ clientY: 150 }] });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveValue("20");
    expect(change).not.toHaveBeenCalled();
  });

  it("accepts external resets without showing NaN or duplicating field errors", () => {
    const props = { "aria-label": "수량", "aria-invalid": true, onValueChange: vi.fn() } as const;
    const { rerender } = render(<NumericInput {...props} value={20} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(<NumericInput {...props} value={100} />);
    expect(screen.getByRole("textbox")).toHaveValue("100");
    rerender(<NumericInput {...props} value={Number.NaN} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});
