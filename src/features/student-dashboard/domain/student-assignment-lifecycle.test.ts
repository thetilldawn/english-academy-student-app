import { describe, expect, it } from "vitest";

import type { StudentAssignmentSummary } from "../model";
import { deriveStudentAssignmentLifecycle } from "./student-assignment-lifecycle";

const now = Date.parse("2026-08-22T03:00:00.000Z");

function assignment(
  overrides: Partial<StudentAssignmentSummary> = {},
): StudentAssignmentSummary {
  return {
    id: "assignment-1",
    assignmentStatus: "active",
    displayTitle: "DAY 01",
    datasetTitle: "테스트 단어장",
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
    assignedAt: "2026-08-20T00:00:00.000Z",
    availableFrom: null,
    availableUntil: null,
    missedAt: null,
    ...overrides,
  };
}

describe("deriveStudentAssignmentLifecycle", () => {
  it("uses an inclusive opening and exclusive closing boundary", () => {
    expect(
      deriveStudentAssignmentLifecycle(
        assignment({ availableFrom: "2026-08-22T03:00:00.001Z" }),
        now,
      ).window.kind,
    ).toBe("scheduled");
    expect(
      deriveStudentAssignmentLifecycle(
        assignment({ availableFrom: "2026-08-22T03:00:00.000Z" }),
        now,
      ).window.kind,
    ).toBe("open");
    expect(
      deriveStudentAssignmentLifecycle(
        assignment({ availableUntil: "2026-08-22T03:00:00.001Z" }),
        now,
      ).window.kind,
    ).toBe("open");
    expect(
      deriveStudentAssignmentLifecycle(
        assignment({ availableUntil: "2026-08-22T03:00:00.000Z" }),
        now,
      ).window,
    ).toMatchObject({ kind: "closed", reason: "deadline" });
  });

  it("keeps a no-deadline active assignment open", () => {
    const lifecycle = deriveStudentAssignmentLifecycle(assignment(), now);
    expect(lifecycle.window).toMatchObject({ kind: "open", closesAt: null });
    expect(lifecycle.actions.canStart).toBe(true);
  });

  it("closes an assignment explicitly closed by the administrator", () => {
    const lifecycle = deriveStudentAssignmentLifecycle(
      assignment({ assignmentStatus: "closed" }),
      now,
    );
    expect(lifecycle.window).toMatchObject({ kind: "closed", reason: "admin" });
    expect(lifecycle.progress).toBe("not_started");
    expect(lifecycle.actions.canStart).toBe(false);
  });

  it.each([
    ["initial", "initial_in_progress"],
    ["retry", "retry_in_progress"],
    ["review", "review_pending"],
  ] as const)("keeps %s progress actionable after the assignment window closes", (phase, progress) => {
    const lifecycle = deriveStudentAssignmentLifecycle(
      assignment({
        availableUntil: "2026-08-22T02:00:00.000Z",
        lastAttemptId: "attempt-1",
        lastPhase: phase,
        lastStatus: "in_progress",
      }),
      now,
    );
    expect(lifecycle.progress).toBe(progress);
    expect(lifecycle.actions.canResume).toBe(phase !== "review");
    expect(lifecycle.actions.canReviewAndRetry).toBe(phase === "review");
  });

  it("shows the result and allows a new attempt only when the open assignment permits it", () => {
    const allowed = deriveStudentAssignmentLifecycle(
      assignment({
        lastAttemptId: "attempt-1",
        lastPhase: "completed",
        lastStatus: "completed",
        retakeAllowed: true,
      }),
      now,
    );
    expect(allowed.actions).toMatchObject({ canStart: true, canViewResult: true });

    const blocked = deriveStudentAssignmentLifecycle(
      assignment({
        lastAttemptId: "attempt-1",
        lastPhase: "completed",
        lastStatus: "completed",
        retakeAllowed: false,
      }),
      now,
    );
    expect(blocked.actions).toMatchObject({ canStart: false, canViewResult: true });
  });

  it("allows an expired attempt to restart only while the assignment is open", () => {
    const open = deriveStudentAssignmentLifecycle(
      assignment({ lastAttemptId: "attempt-1", lastStatus: "expired" }),
      now,
    );
    const closed = deriveStudentAssignmentLifecycle(
      assignment({
        availableUntil: "2026-08-22T02:00:00.000Z",
        lastAttemptId: "attempt-1",
        lastStatus: "expired",
      }),
      now,
    );
    expect(open.actions.canStart).toBe(true);
    expect(closed.actions.canStart).toBe(false);
    expect(closed.actions.canViewResult).toBe(true);
  });

  it("fails closed for a malformed boundary", () => {
    expect(
      deriveStudentAssignmentLifecycle(
        assignment({ availableFrom: "not-a-date" }),
        now,
      ).window,
    ).toMatchObject({ kind: "closed", reason: "invalid_window" });
  });

  it("fails closed when the closing boundary is not after the opening boundary", () => {
    expect(
      deriveStudentAssignmentLifecycle(
        assignment({
          availableFrom: "2026-08-22T04:00:00.000Z",
          availableUntil: "2026-08-22T04:00:00.000Z",
        }),
        now,
      ).window,
    ).toMatchObject({ kind: "closed", reason: "invalid_window" });
  });

  it("never offers a new start after the assignment was finalized as missed", () => {
    const lifecycle = deriveStudentAssignmentLifecycle(
      assignment({ missedAt: "2026-08-21T03:00:00.000Z" }),
      now,
    );

    expect(lifecycle.progress).toBe("missed");
    expect(lifecycle.actions.canStart).toBe(false);
  });

  it("requires an attempt id before exposing attempt actions", () => {
    const lifecycle = deriveStudentAssignmentLifecycle(
      assignment({ lastPhase: "initial", lastStatus: "in_progress" }),
      now,
    );

    expect(lifecycle.actions).toMatchObject({
      canResume: false,
      canReviewAndRetry: false,
      canViewResult: false,
    });
  });
});
