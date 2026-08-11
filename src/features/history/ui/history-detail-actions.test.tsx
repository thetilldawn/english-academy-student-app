// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { adminHistoryText } from "@/content/ko/admin-history";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import type { AssignmentManagerData } from "@/lib/services/assignment-manager-data";

import { HistoryDetailActions } from "./history-detail-actions";

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

const editorData = {
  currentVocabWrongSummaries: [],
  datasets: [
    {
      id: "dataset-1",
      isActive: true,
      isAssignable: true,
      status: "ready",
    },
  ],
  history: [],
  learningSources: [],
  pendingReviewSummaries: [],
  progress: [],
  students: [
    {
      currentVocabDatasetId: "dataset-1",
      displayName: "미리보기 학생",
      id: "student-1",
    },
  ],
  units: [],
} as unknown as AssignmentManagerData;

describe("history detail actions", () => {
  it("delegates editing to the owning detail surface", async () => {
    const user = userEvent.setup();
    const editButtonRef = createRef<HTMLButtonElement>();
    const onEditRequested = vi.fn();
    render(
      <HistoryDetailActions
        editorData={editorData}
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
