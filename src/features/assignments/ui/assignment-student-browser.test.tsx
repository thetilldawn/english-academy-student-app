// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { adminLearningText } from "@/content/ko/admin-learning";

import type { AssignmentWorkspaceController } from "../controller/use-assignment-workspace";
import { AssignmentStudentBrowser } from "./assignment-student-browser";

afterEach(cleanup);

function controllerStub(
  overrides: Partial<AssignmentWorkspaceController> = {},
): AssignmentWorkspaceController {
  return {
    actions: {
      changeAssignmentMode: vi.fn(),
      clearSearch: vi.fn(),
      clearBulkStudents: vi.fn(),
      closePlanner: vi.fn(),
      loadMore: vi.fn(),
      openSingleAssignment: vi.fn(),
      prepareBulkAssignment: vi.fn(),
      refresh: vi.fn(),
      resetFilters: vi.fn(),
      setEntryDatasetId: vi.fn(),
      setEntryMode: vi.fn(),
      setFilter: vi.fn(),
      toggleBulkStudent: vi.fn(),
      toggleFilteredStudents: vi.fn(),
    },
    allFilteredStudentsSelected: false,
    assignmentMode: "bulk",
    canPrepareBulk: false,
    datasetDirectory: {
      actions: { ensure: vi.fn(), retry: vi.fn() },
      datasets: [],
      error: "",
      status: "idle",
    },
    directory: {
      actions: {
        loadMore: vi.fn(),
        replaceFilters: vi.fn(),
        replaceQuery: vi.fn(),
      },
      error: "",
      filtering: false,
      filters: {
        classGroupId: "",
        grade: "",
        query: "",
        school: "",
        status: "active",
        wordbook: "",
        wrong: "all",
      },
      loadingMore: false,
      snapshot: {
        filterOptions: {
          classGroups: [],
          grades: [],
          schools: [],
          wordbooks: [],
        },
        filters: {
          classGroupId: "",
          grade: "",
          query: "",
          school: "",
          status: "active",
          wordbook: "",
          wrong: "all",
        },
        page: { items: [], nextCursor: null },
        snapshotAt: "2026-08-30T00:00:00.000Z",
        totalCount: 0,
      },
    },
    filters: {
      classGroupId: "",
      grade: "",
      query: "",
      school: "",
      status: "active",
      wordbook: "",
      wrong: "all",
    },
    classGroupOptions: [],
    entryMode: "student",
    entryDatasetId: "",
    gradeOptions: [],
    schoolOptions: [],
    selectedBulkStudentIds: [],
    selectedBulkStudents: [],
    selectionError: "",
    selectionLoading: false,
    wordbookOptions: [],
    ...overrides,
  } as unknown as AssignmentWorkspaceController;
}

describe("assignment student browser", () => {
  it("lets a query-only search be cleared without resetting facet filters", async () => {
    const user = userEvent.setup();
    const clearSearch = vi.fn();
    render(
      <AssignmentStudentBrowser
        controller={controllerStub({
          actions: {
            ...controllerStub().actions,
            clearSearch,
          },
          filters: {
            ...controllerStub().filters,
            query: "가람",
          },
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "검색 지우기" }));
    expect(clearSearch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "필터 초기화" })).toBeDisabled();
  });

  it("blocks bulk assignment preparation when no student is selected", () => {
    render(<AssignmentStudentBrowser controller={controllerStub()} />);

    expect(
      screen.getByRole("button", {
        name: adminLearningText.page.bulk.prepare,
      }),
    ).toBeDisabled();
  });

  it("enables assignment preparation after the selected students are ready", () => {
    render(
      <AssignmentStudentBrowser
        controller={controllerStub({
          canPrepareBulk: true,
        })}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: adminLearningText.page.bulk.prepare,
      }),
    ).toBeEnabled();
  });

  it("keeps selected students visible in the basket even when the current list is empty", () => {
    render(
      <AssignmentStudentBrowser
        controller={controllerStub({
          selectedBulkStudents: [
            { id: "student-1", displayName: "선택 학생" },
          ] as never,
        })}
      />,
    );

    expect(screen.getByText("선택 바구니 · 1명")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "선택 학생 선택 해제" }),
    ).toBeInTheDocument();
  });

  it("단일 배정에서는 선택 바구니와 일괄 배정 버튼을 숨긴다", () => {
    render(
      <AssignmentStudentBrowser
        controller={controllerStub({ assignmentMode: "single" })}
      />,
    );

    expect(screen.queryByText("선택 바구니 · 1명")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: adminLearningText.page.bulk.prepare,
      }),
    ).not.toBeInTheDocument();
  });
});
