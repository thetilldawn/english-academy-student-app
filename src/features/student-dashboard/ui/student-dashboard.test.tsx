/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { studentAppText } from "@/content/ko/student-app";
import type {
  StudentDashboardCurrentNode,
  StudentDashboardInitialSnapshot,
} from "../contracts/student-dashboard-read-model";

import type { StudentAssignmentSummary } from "../model";
import { StudentAssignmentCard } from "./student-assignment-card";
import { StudentDashboard } from "./student-dashboard";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

afterEach(() => {
  cleanup();
  refresh.mockReset();
  vi.useRealTimers();
});

function assignment(
  id: string,
  overrides: Partial<StudentAssignmentSummary> = {},
): StudentAssignmentSummary {
  return {
    id,
    assignmentStatus: "active",
    displayTitle: `DAY ${id}`,
    datasetTitle: "[2025] 고3 모의고사 · 장문독해",
    assignmentPurpose: "regular",
    scopeLabel: "DAY 01",
    questionCount: 20,
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
    availableFrom: null,
    availableUntil: null,
    missedAt: null,
    ...overrides,
  };
}

function snapshot(input: {
  completed?: StudentAssignmentSummary[];
  current?: StudentDashboardCurrentNode[];
} = {}): StudentDashboardInitialSnapshot {
  const current = input.current ?? [];
  const completed = input.completed ?? [];
  const count = (section: StudentDashboardCurrentNode["section"]) =>
    current.filter((node) => node.section === section).length;
  return {
    completedPage: { items: completed, nextCursor: null },
    currentAssignments: current,
    sectionCounts: {
      completed: completed.length,
      deadline_closed: count("deadline_closed"),
      needs_attention: count("needs_attention"),
      open: count("open"),
      scheduled: count("scheduled"),
    },
    snapshotAt: "2026-08-22T00:00:00.000Z",
  };
}

describe("StudentDashboard", () => {
  it("renders the dedicated empty state for zero assignments", () => {
    render(
      <StudentDashboard
        currentPoints={17}
        snapshot={snapshot()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      studentAppText.dashboard.emptyTitle,
    );
    expect(screen.getByLabelText("현재 포인트")).toHaveTextContent("17");
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });

  it("renders N-item section counts once in the stable section order", () => {
    const open = assignment("open");
    const failed = assignment("failed", {
        lastAttemptId: "attempt-failed",
        lastStatus: "completed",
        lastPhase: "completed",
        lastInitialScore: 70,
        lastFinalScore: 70,
        lastPassed: false,
        lastCompletedAt: "2026-08-10T00:00:00.000Z",
      });
    const completed = assignment("completed", {
        lastAttemptId: "attempt-completed",
        lastStatus: "completed",
        lastPhase: "completed",
        lastInitialScore: 100,
        lastFinalScore: 100,
        lastPassed: true,
        lastCompletedAt: "2026-08-09T00:00:00.000Z",
      });
    const missed = assignment("missed", {
        availableUntil: "2026-08-08T00:00:00.000Z",
        missedAt: "2026-08-08T00:00:00.000Z",
      });

    const { container } = render(
      <StudentDashboard
        currentPoints={0}
        snapshot={snapshot({
          completed: [completed],
          current: [
            { assignment: open, section: "open" },
            { assignment: failed, section: "needs_attention" },
            { assignment: missed, section: "deadline_closed" },
          ],
        })}
      />,
    );

    expect(
      screen.getAllByRole("heading", { level: 2 }).map((heading) =>
        heading.textContent,
      ),
    ).toEqual([
      studentAppText.dashboard.sections.open,
      studentAppText.dashboard.sections.needsAttention,
      studentAppText.dashboard.sections.completed,
      studentAppText.dashboard.sections.closed,
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
        currentPoints={0}
        snapshot={snapshot({
          current: [{
            assignment: assignment("long", {
              datasetTitle: longTitle,
              displayTitle: "",
            }),
            section: "open",
          }],
        })}
      />,
    );

    expect(screen.getByRole("heading", { level: 3, name: longTitle })).toHaveAttribute(
      "title",
      longTitle,
    );
  });

  it("keeps a completed-only section collapsed by default", () => {
    render(
      <StudentDashboard
        currentPoints={0}
        snapshot={snapshot({
          completed: [assignment("completed-only", {
            lastAttemptId: "attempt-completed",
            lastStatus: "completed",
            lastPhase: "completed",
            lastInitialScore: 100,
            lastFinalScore: 100,
            lastPassed: true,
            lastCompletedAt: "2026-08-09T00:00:00.000Z",
          })],
        })}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: studentAppText.dashboard.sections.completed,
      }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});

describe("StudentAssignmentCard", () => {
  it("keeps only the range as always-visible exam metadata", () => {
    render(<StudentAssignmentCard assignment={assignment("metadata")} />);

    expect(screen.getByText("DAY 01")).toBeVisible();
    expect(screen.queryByText("단어 시험")).not.toBeInTheDocument();
    expect(screen.queryByText("20문항")).not.toBeInTheDocument();
    expect(screen.queryByText("전체 5분")).not.toBeInTheDocument();
    expect(screen.queryByText("80점 통과")).not.toBeInTheDocument();
    expect(screen.queryByText("무작위 순서")).not.toBeInTheDocument();
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
          })
        }
      />,
    );

    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("shows absolute availability and does not offer start before opening", () => {
    render(
      <StudentAssignmentCard
        assignment={
          assignment("scheduled", {
            availableFrom: "2099-08-22T00:00:00.000Z",
            availableUntil: "2099-08-23T13:00:00.000Z",
          })
        }
      />,
    );

    expect(screen.getByText(studentAppText.dashboard.availability.scheduled)).toBeVisible();
    expect(screen.getByText("8월 22일 [토] 오전 9시 00분")).toBeVisible();
    expect(screen.getByText("8월 23일 [일] 오후 10시 00분")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: studentAppText.actions.start }),
    ).not.toBeInTheDocument();
  });

  it("shows no deadline explicitly", () => {
    render(<StudentAssignmentCard assignment={assignment("no-deadline")} />);

    expect(screen.getByText(studentAppText.dashboard.availability.availableNow)).toBeVisible();
    expect(screen.getByText(studentAppText.dashboard.availability.noDeadline)).toBeVisible();
  });

  it("refreshes at the closing boundary when a completed exam can be retaken", async () => {
    vi.useFakeTimers();
    const nowMilliseconds = Date.parse("2026-08-22T00:00:00.000Z");
    render(
      <StudentAssignmentCard
        assignment={
          assignment("retake-closing", {
            availableUntil: "2026-08-22T00:00:01.000Z",
            lastAttemptId: "attempt-retake",
            lastCompletedAt: "2026-08-21T00:00:00.000Z",
            lastFinalScore: 100,
            lastInitialScore: 100,
            lastPassed: true,
            lastPhase: "completed",
            lastStatus: "completed",
          })
        }
        nowMilliseconds={nowMilliseconds}
      />,
    );

    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
