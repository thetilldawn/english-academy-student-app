// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
afterEach(cleanup);

describe("DAY 버튼판", () => {
  it("선택 범위를 aria-pressed로 표시하고 화살표 키로 이동한다", () => {
    const onSelect = vi.fn();
    render(
      <DayRangeRail
        onSelect={onSelect}
        selectedUnitIds={new Set([units[0]!.id, units[1]!.id])}
        selection={{
          startUnitId: units[0]!.id,
          endUnitId: units[1]!.id,
        }}
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
});
