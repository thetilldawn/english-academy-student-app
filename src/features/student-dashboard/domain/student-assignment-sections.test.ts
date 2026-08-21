import { describe, expect, it } from "vitest";

import type { StudentAssignmentSummary } from "../model";
import {
  selectStudentAssignmentSections,
  sortStudentAssignments,
  studentAssignmentTimeline,
} from "./student-assignment-sections";

const now = Date.parse("2026-08-22T00:00:00.000Z");

function assignment(
  id: string,
  overrides: Partial<StudentAssignmentSummary> = {},
): StudentAssignmentSummary {
  return {
    id,
    assignmentStatus: "active",
    title: id,
    displayTitle: `DAY ${id}`,
    datasetTitle: "테스트 단어장",
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
    availableFrom: null,
    availableUntil: null,
    missedAt: null,
    ...overrides,
  };
}

function idsBySection(assignments: readonly StudentAssignmentSummary[]) {
  return Object.fromEntries(
    selectStudentAssignmentSections(assignments, now).map((section) => [
      section.id,
      section.assignments.map((item) => item.id),
    ]),
  );
}

describe("student assignment sections", () => {
  it("returns every section with zero items for an empty dashboard", () => {
    expect(
      selectStudentAssignmentSections([]).map((section) => [
        section.id,
        section.assignments.length,
      ]),
    ).toEqual([
      ["open", 0],
      ["scheduled", 0],
      ["needs-attention", 0],
      ["completed", 0],
      ["deadline-closed", 0],
    ]);
  });

  it("orders resumable work first by its nearest attempt deadline", () => {
    const result = sortStudentAssignments([
      assignment("due-later", {
        availableUntil: "2026-08-14T00:00:00.000Z",
      }),
      assignment("resume-later", {
        lastAttemptId: "attempt-2",
        lastStatus: "in_progress",
        lastPhase: "initial",
        lastStartedAt: "2026-08-10T00:00:00.000Z",
        lastDeadlineAt: "2026-08-12T03:00:00.000Z",
      }),
      assignment("no-deadline", {
        assignedAt: "2026-08-09T00:00:00.000Z",
      }),
      assignment("due-near", {
        availableUntil: "2026-08-13T00:00:00.000Z",
      }),
      assignment("resume-near", {
        lastAttemptId: "attempt-1",
        lastStatus: "in_progress",
        lastPhase: "initial",
        lastStartedAt: "2026-08-10T00:00:00.000Z",
        lastDeadlineAt: "2026-08-12T01:00:00.000Z",
      }),
      assignment("retry-nearest", {
        lastAttemptId: "attempt-3",
        lastStatus: "in_progress",
        lastPhase: "retry",
        lastStartedAt: "2026-08-10T00:00:00.000Z",
        lastRetryStartedAt: "2026-08-10T01:00:00.000Z",
        lastDeadlineAt: "2026-08-12T00:30:00.000Z",
      }),
    ]);

    expect(result.map((item) => item.id)).toEqual([
      "retry-nearest",
      "resume-near",
      "resume-later",
      "no-deadline",
      "due-near",
      "due-later",
    ]);
  });

  it("separates review, failed, completed, and missed assignments once", () => {
    const input = [
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
      }),
      assignment("failed", {
        lastAttemptId: "attempt-failed",
        lastStatus: "completed",
        lastPhase: "completed",
        lastInitialScore: 70,
        lastFinalScore: 70,
        lastPassed: false,
        lastCompletedAt: "2026-08-10T00:00:00.000Z",
      }),
      assignment("review", {
        availableUntil: "2026-08-12T00:00:00.000Z",
        lastAttemptId: "attempt-review",
        lastStatus: "in_progress",
        lastPhase: "review",
        lastInitialScore: 70,
        lastInitialCompletedAt: "2026-08-11T00:00:00.000Z",
      }),
    ];

    expect(idsBySection(input)).toEqual({
      open: [],
      scheduled: [],
      "needs-attention": ["review", "failed"],
      completed: ["completed"],
      "deadline-closed": ["missed"],
    });
    expect(
      selectStudentAssignmentSections(input)
        .flatMap((section) => section.assignments)
        .map((item) => item.id),
    ).toHaveLength(new Set(input.map((item) => item.id)).size);
  });

  it("keeps a future assignment out of the currently open section", () => {
    expect(
      Object.fromEntries(
        selectStudentAssignmentSections(
          [
            assignment("scheduled", {
              availableFrom: "2026-08-23T00:00:00.000Z",
            }),
            assignment("open", {
              availableFrom: "2026-08-21T00:00:00.000Z",
            }),
          ],
          Date.parse("2026-08-22T00:00:00.000Z"),
        ).map((section) => [
          section.id,
          section.assignments.map((item) => item.id),
        ]),
      ),
    ).toMatchObject({ open: ["open"], scheduled: ["scheduled"] });
  });

  it("orders scheduled assignments by opening time rather than assignment time", () => {
    const scheduled = selectStudentAssignmentSections(
      [
        assignment("opens-later", {
          assignedAt: "2026-08-20T00:00:00.000Z",
          availableFrom: "2026-08-24T00:00:00.000Z",
        }),
        assignment("opens-first", {
          assignedAt: "2026-08-21T00:00:00.000Z",
          availableFrom: "2026-08-23T00:00:00.000Z",
        }),
      ],
      now,
    ).find((section) => section.id === "scheduled");

    expect(scheduled?.assignments.map((item) => item.id)).toEqual([
      "opens-first",
      "opens-later",
    ]);
  });

  it("keeps real attempt progress ahead of a stale missed marker", () => {
    const input = [
      assignment("resume", {
        lastAttemptId: "attempt-resume",
        lastStatus: "in_progress",
        lastPhase: "initial",
        missedAt: "2026-08-20T00:00:00.000Z",
      }),
      assignment("completed", {
        lastAttemptId: "attempt-completed",
        lastStatus: "completed",
        lastPhase: "completed",
        lastPassed: true,
        missedAt: "2026-08-20T00:00:00.000Z",
      }),
    ];

    expect(idsBySection(input)).toMatchObject({
      open: ["resume"],
      completed: ["completed"],
      "deadline-closed": [],
    });
  });

  it("is deterministic and does not mutate the source array", () => {
    const input = [assignment("b"), assignment("a")];
    const original = [...input];

    expect(sortStudentAssignments(input).map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
    expect(input).toEqual(original);
  });

  it("shows the same attempt deadline that orders an in-progress exam", () => {
    const timeline = studentAssignmentTimeline(
      assignment("resume", {
        availableUntil: "2026-08-20T00:00:00.000Z",
        lastStatus: "in_progress",
        lastPhase: "retry",
        lastStartedAt: "2026-08-11T00:00:00.000Z",
        lastRetryStartedAt: "2026-08-11T01:00:00.000Z",
        lastDeadlineAt: "2026-08-11T02:00:00.000Z",
      }),
    );

    expect(timeline.availableUntil).toBe("2026-08-11T02:00:00.000Z");
  });
});
