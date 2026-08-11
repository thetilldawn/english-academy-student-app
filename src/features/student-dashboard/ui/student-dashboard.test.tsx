/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { studentAppText } from "@/content/ko/student-app";

import type { StudentAssignmentSummary } from "../model";
import { StudentAssignmentCard } from "./student-assignment-card";
import { StudentDashboard } from "./student-dashboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

function assignment(
  id: string,
  overrides: Partial<StudentAssignmentSummary> = {},
): StudentAssignmentSummary {
  return {
    id,
    title: id,
    displayTitle: `DAY ${id}`,
    datasetTitle: "[2025] 고3 모의고사 · 장문독해",
    assignmentPurpose: "regular",
    scopeLabel: "DAY 01",
    questionCount: 20,
    questionOrderMode: "random",
    timeLimitSeconds: 300,
    timingMode: "total",
    questionTimeLimitSeconds: null,
    passingScore: 80,
    retakeAllowed: true,
    lastAttemptId: null,
    lastStatus: null,
    lastPhase: null,
    lastInitialScore: null,
    lastFinalScore: null,
    lastPassed: null,
    lastRetryStartedAt: null,
    lastStartedAt: null,
    lastInitialCompletedAt: null,
    lastCompletedAt: null,
    lastDeadlineAt: null,
    lastUnresolvedWrongCount: null,
    assignedAt: "2026-08-01T00:00:00.000Z",
    availableUntil: null,
    missedAt: null,
    missed: false,
    canStart: false,
    ...overrides,
  };
}

describe("StudentDashboard", () => {
  it("renders the dedicated empty state for zero assignments", () => {
    render(<StudentDashboard assignments={[]} displayName="테스트" />);

    expect(screen.getByRole("status")).toHaveTextContent(
      studentAppText.dashboard.emptyTitle,
    );
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });

  it("renders N-item section counts once in the stable section order", () => {
    const assignments = [
      assignment("open"),
      assignment("failed", {
        lastAttemptId: "attempt-failed",
        lastStatus: "completed",
        lastPhase: "completed",
        lastInitialScore: 70,
        lastFinalScore: 70,
        lastPassed: false,
        lastCompletedAt: "2026-08-10T00:00:00.000Z",
      }),
      assignment("completed", {
        lastAttemptId: "attempt-completed",
        lastStatus: "completed",
        lastPhase: "completed",
        lastInitialScore: 100,
        lastFinalScore: 100,
        lastPassed: true,
        lastCompletedAt: "2026-08-09T00:00:00.000Z",
      }),
      assignment("missed", {
        availableUntil: "2026-08-08T00:00:00.000Z",
        missedAt: "2026-08-08T00:00:00.000Z",
        missed: true,
      }),
    ];

    const { container } = render(
      <StudentDashboard assignments={assignments} displayName="테스트" />,
    );

    expect(
      screen.getAllByRole("heading", { level: 2 }).map((heading) =>
        heading.textContent,
      ),
    ).toEqual([
      studentAppText.dashboard.sections.open,
      studentAppText.dashboard.sections.needsAttention,
      studentAppText.dashboard.sections.completed,
      studentAppText.dashboard.expired,
    ]);
    for (const section of container.querySelectorAll(
      "[data-assignment-section]",
    )) {
      expect(within(section as HTMLElement).getByText("1건")).toBeVisible();
    }
    expect(container.querySelectorAll("[data-assignment-id]")).toHaveLength(4);
  });

  it("keeps a long dataset title as the card heading when displayTitle is empty", () => {
    const longTitle =
      "아주 긴 이름의 고등학교 시험 대비 장문독해 단어장 ".repeat(6).trim();
    render(
      <StudentDashboard
        assignments={[
          assignment("long", { datasetTitle: longTitle, displayTitle: "" }),
        ]}
        displayName="테스트"
      />,
    );

    expect(screen.getByRole("heading", { level: 3, name: longTitle })).toHaveAttribute(
      "title",
      longTitle,
    );
  });
});

describe("StudentAssignmentCard", () => {
  it("renders the complete vocabulary exam metadata", () => {
    render(<StudentAssignmentCard assignment={assignment("metadata")} />);

    for (const text of [
      "단어 시험",
      "DAY 01",
      "20문항",
      "전체 5분",
      "80점 통과",
      "무작위 순서",
    ]) {
      expect(screen.getByText(text)).toBeVisible();
    }
  });

  it("routes review-pending and resumable attempts to their distinct screens", () => {
    const { rerender } = render(
      <StudentAssignmentCard
        assignment={
          assignment("review", {
            lastAttemptId: "attempt-review",
            lastStatus: "in_progress",
            lastPhase: "review",
            lastInitialScore: 70,
            lastInitialCompletedAt: "2026-08-11T00:00:00.000Z",
          })
        }
      />,
    );
    expect(
      screen.getByRole("link", {
        name: studentAppText.dashboard.resultAndRetry,
      }),
    ).toHaveAttribute("href", "/student/result/attempt-review");

    rerender(
      <StudentAssignmentCard
        assignment={
          assignment("resume", {
            lastAttemptId: "attempt-resume",
            lastStatus: "in_progress",
            lastPhase: "initial",
            lastStartedAt: "2026-08-11T00:00:00.000Z",
            lastDeadlineAt: "2026-08-11T01:00:00.000Z",
          })
        }
      />,
    );
    expect(
      screen.getByRole("link", { name: studentAppText.dashboard.resume }),
    ).toHaveAttribute("href", "/student/attempt/attempt-resume");
  });

  it("does not render a redundant countdown for a finalized missed exam", () => {
    render(
      <StudentAssignmentCard
        assignment={
          assignment("missed", {
            availableUntil: "2026-08-08T00:00:00.000Z",
            missedAt: "2026-08-08T00:00:00.000Z",
            missed: true,
          })
        }
      />,
    );

    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });
});
