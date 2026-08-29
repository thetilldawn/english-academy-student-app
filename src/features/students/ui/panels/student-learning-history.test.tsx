// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { AdminHistoryListItem } from "@/features/history/contracts/admin-history-read-model";

import {
  emptyStudentHistoryFilters,
  type StudentHistoryPage,
} from "../../contracts/student-detail-read-model";
import type { StudentHistoryPageController } from "../../controller/use-student-history-page";
import { StudentLearningHistory } from "./student-learning-history";

afterEach(cleanup);

type ActivitySection = "archived" | "completed" | "needs_attention" | "open";

function activity(index: number, section: ActivitySection): AdminHistoryListItem {
  const date = `2026-08-${String(index).padStart(2, "0")}T00:00:00.000Z`;
  const completed = section === "completed";
  const missed = section === "needs_attention";
  const archived = section === "archived";

  return {
    activityAt: date,
    assignedAt: date,
    assignmentId: `assignment-${index}`,
    assignmentPurpose: "regular",
    assignmentTitle: `시험 ${index}`,
    attemptId: completed ? `attempt-${index}` : null,
    availableUntil: null,
    cancelledAt: archived ? date : null,
    completedAt: completed ? date : null,
    datasetTitle: "테스트 단어장",
    deadlineAt: null,
    finalScore: completed ? 100 : null,
    id: `item-${index}`,
    initialCompletedAt: completed ? date : null,
    initialScore: completed ? 100 : null,
    missedAt: missed ? date : null,
    passed: completed ? true : null,
    passingScore: 80,
    phase: completed ? "completed" : null,
    primaryUnitLabels: ["DAY 01"],
    questionCount: 20,
    retryStartedAt: null,
    startedAt: completed ? date : null,
    status: archived
      ? "cancelled"
      : missed
        ? "missed"
        : completed
          ? "completed"
          : "not_started",
    studentId: "00000000-0000-4000-8000-000000000001",
    studentName: "테스트 학생",
    unitLabels: ["DAY 01"],
  };
}

const allItems = [
  ...Array.from({ length: 16 }, (_, index) => activity(index + 1, "open")),
  ...Array.from({ length: 4 }, (_, index) =>
    activity(index + 17, "needs_attention"),
  ),
  ...Array.from({ length: 5 }, (_, index) => activity(index + 21, "completed")),
  ...Array.from({ length: 4 }, (_, index) => activity(index + 26, "archived")),
];

function HistoryHarness() {
  const [page, setPage] = useState<StudentHistoryPage>({
    items: allItems.slice(0, 20),
    nextCursor: "third-page",
    totalCount: 29,
  });
  const controller = {
    error: "",
    filtering: false,
    filters: emptyStudentHistoryFilters,
    loadingMore: false,
    page,
    actions: {
      loadMore: async () => {
        setPage({ items: allItems, nextCursor: null, totalCount: 29 });
      },
      replaceFilters: async () => {},
    },
  } as StudentHistoryPageController;

  return <StudentLearningHistory controller={controller} />;
}

describe("StudentLearningHistory", () => {
  it("uses only the outer 10-record pagination and exposes every loaded row", async () => {
    const user = userEvent.setup();
    render(<HistoryHarness />);

    expect(screen.getAllByRole("listitem", { hidden: true })).toHaveLength(20);
    expect(
      screen.queryByRole("button", { name: /전체 20개 보기/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "10건 더보기" }));

    await waitFor(() =>
      expect(screen.getAllByRole("listitem", { hidden: true })).toHaveLength(29),
    );
    expect(
      screen.queryByRole("button", { name: /전체 29개 보기/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "10건 더보기" }),
    ).not.toBeInTheDocument();
  });
});
