// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FilterWorkspace, FilterWorkspaceGroup } from "./filter-workspace";

describe("FilterWorkspace", () => {
  it("keeps feature controls in slots and reports search changes", () => {
    const onQueryChange = vi.fn();

    render(
      <FilterWorkspace
        activeFilterCount={2}
        activeTags={<span>선택 조건</span>}
        filterLabel="필터"
        onQueryChange={onQueryChange}
        query=""
        searchAriaLabel="학생 검색"
        searchPlaceholder="이름 검색"
        summaryActions={<button type="button">초기화</button>}
      >
        <FilterWorkspaceGroup label="상태">
          <button type="button">재학</button>
        </FilterWorkspaceGroup>
      </FilterWorkspace>,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "학생 검색" }), {
      target: { value: "김" },
    });

    expect(onQueryChange).toHaveBeenCalledWith("김");
    expect(screen.getByText("선택 조건")).toBeTruthy();
    expect(screen.getByRole("button", { name: "초기화" })).toBeTruthy();
  });
});
