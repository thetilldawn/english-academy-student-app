// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VocabRangeFields } from "./vocab-range-fields";
import type { AssignmentUnitItem } from "../catalog-types";

const unit = (id: string, year: number | null, kind: "mock" | "csat" = "mock"): AssignmentUnitItem => ({
  id, datasetId: "fake-book", label: id, displayName: id, entryCount: 4, kind: "supplement", number: null, sortIndex: year ?? 0,
  catalogGroup: kind === "csat" ? "csat" : "high_mock", unitType: "exam_scope", academicYear: year, examMonth: year ? 9 : null,
  agency: "가짜", itemRange: "41–42", catalogSortIndex: 0,
  ...(year ? { mockScope: { executionYear: year, examMonth: 9, examKind: kind, academicYear: kind === "csat" ? year + 1 : null, agency: "가짜", typeCode: "long", typeLabel: "장문독해", questionNumbers: [41, 42], sharedPassage: true } } : {}),
});
afterEach(cleanup);
describe("mixed mock source ranges", () => {
  it("keeps tagged filters usable with an unclassified unit and lets the user include that unit explicitly", () => {
    const select = vi.fn(), all = vi.fn();
    render(<VocabRangeFields units={[unit("가짜 2024 범위", 2024), unit("가짜 2026 범위", 2026), unit("가짜 미분류 범위", null)]}
      selectedUnitIds={[]} onSelectUnit={select} onToggleAllUnits={all} onOpenDatasetPicker={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "2026년" }));
    expect(screen.getByLabelText("연도·유형 분류가 없는 범위 1개 함께 보기")).toBeChecked();
    expect(screen.getByText("가짜 미분류 범위")).toBeVisible();
    expect(screen.queryByText("가짜 2024 범위")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("연도·유형 분류가 없는 범위 1개 함께 보기"));
    expect(screen.queryByText("가짜 미분류 범위")).not.toBeInTheDocument();
    expect(all).not.toHaveBeenCalled();
  });
  it("filters CSAT by execution year without converting academic year and preserves hidden selections", () => {
    render(<VocabRangeFields units={[unit("모의고사 장문", 2024), unit("수능 장문", 2025, "csat")]}
      selectedUnitIds={["모의고사 장문"]} onSelectUnit={vi.fn()} onToggleAllUnits={vi.fn()} onOpenDatasetPicker={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("시작 연도"), { target: { value: "2025" } });
    fireEvent.change(screen.getByLabelText("끝 연도"), { target: { value: "2025" } });
    expect(screen.getByText("현재 조건에서 보이지 않는 선택 1개")).toBeVisible();
    expect(screen.getByText("수능 장문")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "41번" }));
    expect(screen.getByText("수능 장문")).toBeVisible();
  });
});
