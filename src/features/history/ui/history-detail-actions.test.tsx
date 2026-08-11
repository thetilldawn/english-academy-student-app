// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { adminHistoryText } from "@/content/ko/admin-history";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import type { AssignmentManagerData } from "@/lib/services/assignment-manager-data";

import { HistoryDetailActions } from "./history-detail-actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/features/assignments/ui/single-assignment-editor", () => ({
  SingleAssignmentEditor: () => <div>편집 양식</div>,
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
      displayName: "프리뷰 학생",
      id: "student-1",
    },
  ],
  units: [],
} as unknown as AssignmentManagerData;

describe("history detail actions", () => {
  it("moves focus into the editor and restores it when the editor closes", async () => {
    const user = userEvent.setup();
    render(
      <HistoryDetailActions
        editorData={editorData}
        item={item}
        mode="overlay"
      />,
    );

    const editButton = screen.getByRole("button", {
      name: adminHistoryText.actions.edit,
    });
    await user.click(editButton);

    const editorHeading = screen.getByRole("heading", {
      name: adminHistoryText.actions.edit,
    });
    await waitFor(() => expect(editorHeading).toHaveFocus());

    await user.click(
      screen.getByRole("button", {
        name: adminHistoryText.detailModal.close,
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: adminHistoryText.actions.edit }),
      ).toHaveFocus(),
    );
  });
});
