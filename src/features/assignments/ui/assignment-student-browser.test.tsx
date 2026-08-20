// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
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
      clearBulkStudents: vi.fn(),
      resetFilters: vi.fn(),
      setBulkMode: vi.fn(),
      setEntryDatasetId: vi.fn(),
      setEntryMode: vi.fn(),
      setFilter: vi.fn(),
      toggleBulkStudent: vi.fn(),
      toggleFilteredStudents: vi.fn(),
    },
    allFilteredStudentsSelected: false,
    canPrepareBulk: false,
    filteredStudents: [],
    filters: {
      classGroup: "",
      grade: "",
      query: "",
      school: "",
      status: "active",
      wordbook: "",
      wrongWord: "all",
    },
    classGroupOptions: [],
    entryMode: "student",
    entryDatasetId: "",
    gradeOptions: [],
    readyDatasets: [],
    schoolOptions: [],
    selectedBulkStudentIds: ["student-1"],
    selectedBulkStudents: [],
    wordbookOptions: [],
    ...overrides,
  } as unknown as AssignmentWorkspaceController;
}

describe("assignment student browser", () => {
  it("blocks assignment preparation when no assignable wordbook exists", () => {
    render(<AssignmentStudentBrowser controller={controllerStub()} />);

    expect(
      screen.getByRole("button", {
        name: adminLearningText.page.bulk.prepare,
      }),
    ).toBeDisabled();
    expect(
      screen.getByText(adminLearningText.page.bulk.noReadyDatasets),
    ).toHaveAttribute("role", "status");
  });

  it("enables assignment preparation only after students and an assignable wordbook exist", () => {
    render(
      <AssignmentStudentBrowser
        controller={controllerStub({
          canPrepareBulk: true,
          readyDatasets: [{ id: "dataset-1" }] as never,
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
});
