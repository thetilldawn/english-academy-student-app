// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { adminHistoryText } from "@/content/ko/admin-history";
import type { AssignmentHistorySummary } from "@/lib/admin/history";

import { HistoryDetailActions } from "./history-detail-actions";

vi.mock("next/link", () => ({
  default: ({ prefetch, ...props }: ComponentProps<"a"> & {
    prefetch?: boolean;
  }) => <a data-prefetch={String(prefetch)} {...props} />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("./admin-history-actions", () => ({
  AdminHistoryActions: () => <div>내역 작업</div>,
}));

afterEach(cleanup);

const item = {
  assignmentDeleted: false,
  assignmentId: "assignment-1",
  assignmentStatus: "active",
  attemptId: null,
  availableUntil: null,
  datasetId: "dataset-1",
  primaryUnitIds: [],
  status: "not_started",
  studentDeleted: false,
  studentId: "student-1",
  studentStatus: "active",
} as unknown as AssignmentHistorySummary;

describe("history detail actions", () => {
  it("opens the student through the ID-based detail route without eager prefetch", () => {
    render(
      <HistoryDetailActions
        item={item}
        mode="page"
        onEditRequested={vi.fn()}
      />,
    );

    const studentLink = screen.getByRole("link", {
      name: adminHistoryText.detailModal.openStudent,
    });
    expect(studentLink).toHaveAttribute("href", "/admin/students/student-1");
    expect(studentLink).toHaveAttribute("data-prefetch", "false");
  });

  it("delegates editing to the owning detail surface", async () => {
    const user = userEvent.setup();
    const editButtonRef = createRef<HTMLButtonElement>();
    const onEditRequested = vi.fn();
    render(
      <HistoryDetailActions
        editButtonRef={editButtonRef}
        item={item}
        mode="overlay"
        onEditRequested={onEditRequested}
      />,
    );

    const editButton = screen.getByRole("button", {
      name: adminHistoryText.actions.edit,
    });
    expect(editButtonRef.current).toBe(editButton);

    await user.click(editButton);
    expect(onEditRequested).toHaveBeenCalledOnce();
  });
});
