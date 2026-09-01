// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  NavigableRowLinkComponent,
} from "@/design-system/patterns/activity-row/activity-row";
import type { AssignmentHistorySummary } from "@/lib/admin/history";

import type { ActivityTimelineInput } from "../presentation/activity-presentation";
import { ActivityStatusTimeline } from "./activity-status-timeline";
import { AttemptScoreSummary } from "./attempt-score-summary";
import { HistoryActivityRow } from "./history-activity-row";

afterEach(cleanup);

function activity(
  overrides: Partial<ActivityTimelineInput> = {},
): ActivityTimelineInput {
  return {
    activityAt: "2026-08-08T00:00:00.000Z",
    assignedAt: "2026-08-08T00:00:00.000Z",
    availableUntil: "2026-08-09T06:20:00.000Z",
    cancelledAt: null,
    completedAt: null,
    deadlineAt: null,
    finalScore: null,
    initialCompletedAt: null,
    initialScore: null,
    missedAt: null,
    passed: null,
    passingScore: 80,
    phase: null,
    retryStartedAt: null,
    startedAt: null,
    status: "not_started",
    ...overrides,
  };
}

function historyItem(
  overrides: Partial<AssignmentHistorySummary> = {},
): AssignmentHistorySummary {
  return {
    activityAt: "2026-08-08T00:00:00.000Z",
    assignedAt: "2026-08-08T00:00:00.000Z",
    assignmentDeleted: false,
    assignmentId: "assignment-1",
    assignmentPurpose: "regular",
    assignmentStatus: "active",
    assignmentTitle: "DAY 01",
    attemptId: null,
    attemptNumber: null,
    availableFrom: null,
    availableUntil: "2026-08-09T06:20:00.000Z",
    cancellationReason: null,
    cancelledAt: null,
    completedAt: null,
    datasetId: "dataset-1",
    datasetTitle: "능률 VOCA",
    deadlineAt: null,
    englishToKoreanRatio: 50,
    finalScore: null,
    gradeLabel: "고3",
    id: "assignment-1:student-1",
    initialCompletedAt: null,
    initialCorrectCount: null,
    initialScore: null,
    missedAt: null,
    passed: null,
    passingScore: 80,
    phase: null,
    primaryUnitIds: ["unit-1"],
    primaryUnitLabels: ["DAY 01"],
    questionCount: 44,
    questionOrderMode: "random",
    retryCorrectCount: null,
    retryStartedAt: null,
    schoolName: "미리보기고",
    startedAt: null,
    status: "not_started",
    studentDeleted: false,
    studentId: "student-1",
    studentName: "프리뷰 학생",
    studentStatus: "active",
    timeLimitSeconds: 300,
    timingMode: "total",
    questionTimeLimitSeconds: null,
    unitIds: ["unit-1"],
    unitLabels: ["DAY 01"],
    unresolvedWrongCount: null,
    ...overrides,
  };
}

describe("history presentation components", () => {
  it("renders deadline before status with a machine-readable timestamp", () => {
    render(<ActivityStatusTimeline item={activity()} />);

    expect(screen.getAllByText(/마감|응시 전/).map((node) => node.textContent)).toEqual([
      "마감",
      "응시 전",
    ]);
    expect(screen.getByRole("time")).toHaveAttribute(
      "datetime",
      "2026-08-09T06:20:00.000Z",
    );
    expect(screen.getByRole("time")).toHaveTextContent(
      "8월 9일 [일] 오후 3시 20분",
    );
  });

  it("can omit the deadline without leaving an empty row", () => {
    const { container } = render(
      <ActivityStatusTimeline item={activity()} showDeadline={false} />,
    );

    expect(screen.queryByText("마감")).not.toBeInTheDocument();
    expect(screen.getByText("응시 전")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-kind="status"]')).toHaveLength(1);
  });

  it("uses compact score values and preserves only the intentional grid placeholder", () => {
    const { container } = render(
      <AttemptScoreSummary
        compact
        finalScore={100}
        initialScore={60}
        passed
        passingScore={80}
        phase="completed"
        retryStartedAt="2026-08-08T01:00:00.000Z"
        status="completed"
      />,
    );

    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.queryByText("60점")).not.toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("renders nothing when compact missed scores have no meaningful value", () => {
    const { container } = render(
      <AttemptScoreSummary
        compact
        finalScore={null}
        initialScore={null}
        passed={false}
        passingScore={80}
        phase={null}
        retryStartedAt={null}
        status="missed"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("does not reserve a score column for a compact missed history row", () => {
    const { container } = render(
      <HistoryActivityRow
        compact
        item={historyItem({
          missedAt: "2026-08-09T06:20:00.000Z",
          status: "missed",
        })}
      />,
    );

    expect(container.querySelector("[data-has-score]")).toHaveAttribute(
      "data-has-score",
      "false",
    );
  });

  it("does not prefetch every visible history detail row", () => {
    const LinkProbe: NavigableRowLinkComponent = ({
      prefetch,
      scroll,
      ...props
    }) => (
      <a
        data-prefetch={String(prefetch)}
        data-scroll={String(scroll)}
        {...props}
      />
    );

    render(
      <HistoryActivityRow
        item={historyItem()}
        linkComponent={LinkProbe}
      />,
    );

    expect(screen.getByRole("link")).toHaveAttribute("data-prefetch", "false");
  });
});
