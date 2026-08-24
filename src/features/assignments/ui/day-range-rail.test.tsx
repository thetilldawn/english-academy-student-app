// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssignmentUnitItem } from "../catalog-types";
import { DayRangeRail } from "./day-range-rail";

const units = [1, 2, 3].map((number) => ({
  id: `00000000-0000-4000-8000-00000000000${number}`,
  datasetId: "00000000-0000-4000-8000-000000000010",
  entryCount: 20,
  kind: "day",
  label: `DAY ${number}`,
  number,
  sortIndex: number,
  displayName: `DAY ${number}`,
  catalogGroup: "middle",
  unitType: "day",
  academicYear: null,
  examMonth: null,
  agency: null,
  itemRange: null,
  catalogSortIndex: number,
})) satisfies AssignmentUnitItem[];

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
});
afterEach(cleanup);

describe("DAY 버튼판", () => {
  it("선택 범위를 aria-pressed로 표시하고 화살표 키로 이동한다", () => {
    const onSelect = vi.fn();
    render(
      <DayRangeRail
        onSelect={onSelect}
        selectedUnitIds={new Set([units[0]!.id, units[1]!.id])}
        units={units}
      />,
    );

    const first = screen.getByRole("button", { name: "DAY 1" });
    const second = screen.getByRole("button", { name: "DAY 2" });
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "true");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(second).toHaveFocus();
    fireEvent.click(second);
    expect(onSelect).toHaveBeenCalledWith(units[1]!.id);
  });

  it("짧은 포인터 클릭은 가로 드래그로 가로채지 않는다", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <DayRangeRail
        onSelect={onSelect}
        selectedUnitIds={new Set()}
        units={units}
      />,
    );

    await user.click(screen.getByRole("button", { name: "DAY 1" }));

    expect(HTMLElement.prototype.setPointerCapture).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith(units[0]!.id);
  });

  it("5px를 넘긴 버튼 드래그만 스크롤하고 선택을 한 번 막은 뒤 해제한다", () => {
    const onSelect = vi.fn();
    vi.mocked(HTMLElement.prototype.hasPointerCapture).mockReturnValue(true);
    render(
      <DayRangeRail
        onSelect={onSelect}
        selectedUnitIds={new Set()}
        units={units}
      />,
    );

    const rail = screen.getByRole("group", { name: "단어 범위" });
    const first = screen.getByRole("button", { name: "DAY 1" });
    rail.scrollLeft = 40;
    fireEvent.pointerDown(first, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(first, { clientX: 97, pointerId: 1 });
    expect(HTMLElement.prototype.setPointerCapture).not.toHaveBeenCalled();
    expect(rail.scrollLeft).toBe(40);

    fireEvent.pointerMove(first, { clientX: 80, pointerId: 1 });
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(1);
    expect(rail).toHaveAttribute("data-dragging", "true");
    expect(rail.scrollLeft).toBe(60);

    fireEvent.pointerUp(rail, { pointerId: 1 });
    expect(HTMLElement.prototype.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(rail).toHaveAttribute("data-dragging", "false");

    fireEvent.click(first);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(first);
    expect(onSelect).toHaveBeenCalledWith(units[0]!.id);
  });
});
