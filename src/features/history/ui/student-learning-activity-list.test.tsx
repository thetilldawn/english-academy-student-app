// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { AssignmentHistorySummary } from "@/lib/admin/history";

import { StudentLearningActivityList } from "./student-learning-activity-list";

afterEach(cleanup);

function openItem(index: number): AssignmentHistorySummary {
  const id = `item-${index}`;
  return {
    activityAt: `2026-08-${String(index).padStart(2, "0")}T00:00:00.000Z`,
    assignedAt: `2026-08-${String(index).padStart(2, "0")}T00:00:00.000Z`,
    assignmentDeleted: false,
    assignmentId: `assignment-${index}`,
    assignmentPurpose: "regular",
    assignmentStatus: "active",
    assignmentTitle: `시험 ${index}`,
    attemptId: null,
    attemptNumber: null,
    availableFrom: null,
    availableUntil: null,
    cancellationReason: null,
    cancelledAt: null,
    completedAt: null,
    datasetId: "dataset-1",
    datasetTitle: "테스트 단어장",
    deadlineAt: null,
    englishToKoreanRatio: 50,
    finalScore: null,
    gradeLabel: "고3",
    id,
    initialCompletedAt: null,
    initialCorrectCount: null,
    initialScore: null,
    missedAt: null,
    passed: null,
    passingScore: 80,
    phase: null,
    primaryUnitIds: ["unit-1"],
    primaryUnitLabels: ["DAY 01"],
    questionCount: 20,
    questionOrderMode: "random",
    questionTimeLimitSeconds: null,
    retryCorrectCount: null,
    retryStartedAt: null,
    schoolName: "테스트고",
    startedAt: null,
    status: "not_started",
    studentDeleted: false,
    studentId: "student-1",
    studentName: "테스트 학생",
    studentStatus: "active",
    timeLimitSeconds: 300,
    timingMode: "total",
    unitIds: ["unit-1"],
    unitLabels: ["DAY 01"],
    unresolvedWrongCount: null,
  };
}

describe("StudentLearningActivityList", () => {
  it("renders every server-loaded row without a second local limit", () => {
    render(
      <StudentLearningActivityList
        displayMode="all-loaded"
        initialLimit={10}
        items={Array.from({ length: 16 }, (_, index) => openItem(index + 1))}
      />,
    );

    expect(screen.getByText("16건")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(16);
    expect(
      screen.queryByRole("button", { name: /전체 16개 보기/ }),
    ).not.toBeInTheDocument();
  });

  it("counts the full filtered section before limiting visible rows", async () => {
    const user = userEvent.setup();
    render(
      <StudentLearningActivityList
        initialLimit={5}
        items={Array.from({ length: 6 }, (_, index) => openItem(index + 1))}
      />,
    );

    expect(screen.getByText("6건")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);

    await user.click(screen.getByRole("button", { name: /전체 6개 보기/ }));

    expect(screen.getByText("6건")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("keeps every nonempty status header even when another status fills the initial limit", async () => {
    const user = userEvent.setup();
    const completed = {
      ...openItem(7),
      activityAt: "2026-07-01T00:00:00.000Z",
      completedAt: "2026-07-01T00:00:00.000Z",
      finalScore: 100,
      initialCompletedAt: "2026-07-01T00:00:00.000Z",
      initialScore: 100,
      passed: true,
      phase: "completed" as const,
      status: "completed" as const,
    };
    render(
      <StudentLearningActivityList
        initialLimit={5}
        items={[
          ...Array.from({ length: 5 }, (_, index) => openItem(index + 1)),
          completed,
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "완료" })).toBeInTheDocument();
    expect(screen.getByText("1건")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);

    await user.click(screen.getByRole("button", { name: /완료/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("preserves the activity priority order inside each visible section", () => {
    const resumable = {
      ...openItem(1),
      activityAt: "2026-08-01T00:00:00.000Z",
      attemptId: "attempt-1",
      deadlineAt: "2026-08-23T00:00:00.000Z",
      phase: "initial" as const,
      startedAt: "2026-08-01T00:00:00.000Z",
      status: "in_progress" as const,
    };
    const newlyAssigned = openItem(20);
    render(
      <StudentLearningActivityList
        initialLimit={5}
        items={[newlyAssigned, resumable]}
      />,
    );

    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]!).getByText("시험 1")).toBeVisible();
    expect(within(rows[1]!).getByText("시험 20")).toBeVisible();
  });
});
