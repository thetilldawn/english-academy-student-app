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
      setFilter: vi.fn(),
      toggleFilteredStudents: vi.fn(),
    },
    allFilteredStudentsSelected: false,
    filteredStudents: [],
    filters: {
      grade: "",
      query: "",
      school: "",
      wordbook: "",
      wrongWord: "all",
    },
    gradeOptions: [],
    readyDatasets: [],
    schoolOptions: [],
    selectedBulkStudentIds: ["student-1"],
    wordbookOptions: [],
    ...overrides,
  } as unknown as AssignmentWorkspaceController;
}

describe("assignment student browser", () => {
  it("blocks both bulk assignment actions when no assignable wordbook exists", () => {
    render(<AssignmentStudentBrowser controller={controllerStub()} />);

    expect(
      screen.getByRole("button", {
        name: adminLearningText.page.bulk.includeWrong,
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: adminLearningText.page.bulk.assignNext,
      }),
    ).toBeDisabled();
    expect(
      screen.getByText(adminLearningText.page.bulk.noReadyDatasets),
    ).toHaveAttribute("role", "status");
  });

  it("enables bulk actions only after students and an assignable wordbook exist", () => {
    render(
      <AssignmentStudentBrowser
        controller={controllerStub({
          readyDatasets: [{ id: "dataset-1" }] as never,
        })}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: adminLearningText.page.bulk.includeWrong,
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: adminLearningText.page.bulk.assignNext,
      }),
    ).toBeEnabled();
  });
});
