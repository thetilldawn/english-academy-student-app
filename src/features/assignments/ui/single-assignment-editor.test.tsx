// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssignmentStudentItem } from "../catalog-types";
import { SingleAssignmentEditor } from "./single-assignment-editor";

const mocks = vi.hoisted(() => ({
  useController: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("../controller/use-assignment-controller", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../controller/use-assignment-controller")
  >();
  return { ...actual, useAssignmentController: mocks.useController };
});

vi.mock("./single-assignment-editor-sections", () => ({
  SingleAssignmentEditorSections: () => <div>실제 편집 폼</div>,
}));

const student = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "가짜 학생",
  schoolName: "미리보기고",
} as AssignmentStudentItem;

function controller(loadStatus: "loading" | "ready" | "error") {
  return {
    actions: { submit: vi.fn() },
    canSubmit: false,
    dirty: false,
    issues: [],
    loadStatus,
    message: loadStatus === "error" ? "수정 정보를 불러오지 못했습니다." : "",
    state: {
      draft: { review: { mode: "none" } },
      submission: { status: "idle" },
    },
    submitBlocker: { code: loadStatus === "error" ? "load_failed" : "loading" },
  };
}

function renderEditor() {
  return render(
    <SingleAssignmentEditor
      datasets={[]}
      editTarget={{
        assignmentId: "22222222-2222-4222-8222-222222222222",
        purpose: "regular",
        studentId: student.id,
      }}
      initialDatasetId=""
      onSucceeded={vi.fn()}
      placement="dialog"
      progress={null}
      student={student}
      submitPlacement="external"
      units={[]}
    />,
  );
}

afterEach(() => {
  cleanup();
  mocks.useController.mockReset();
});

describe("SingleAssignmentEditor loading surface", () => {
  it("keeps a stable loading skeleton and mounts the real form only when ready", () => {
    mocks.useController.mockReturnValue(controller("loading"));
    const view = renderEditor();

    expect(screen.getByRole("status")).toHaveTextContent("불러오는 중");
    expect(screen.queryByText("실제 편집 폼")).not.toBeInTheDocument();

    mocks.useController.mockReturnValue(controller("ready"));
    view.rerender(
      <SingleAssignmentEditor
        datasets={[]}
        editTarget={{
          assignmentId: "22222222-2222-4222-8222-222222222222",
          purpose: "regular",
          studentId: student.id,
        }}
        initialDatasetId=""
        onSucceeded={vi.fn()}
        placement="dialog"
        progress={null}
        student={student}
        submitPlacement="external"
        units={[]}
      />,
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("실제 편집 폼")).toBeVisible();
  });

  it("shows the load failure instead of an editable fallback draft", () => {
    mocks.useController.mockReturnValue(controller("error"));
    renderEditor();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "수정 정보를 불러오지 못했습니다.",
    );
    expect(screen.queryByText("실제 편집 폼")).not.toBeInTheDocument();
  });
});
