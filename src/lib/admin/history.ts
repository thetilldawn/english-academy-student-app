export type AssignmentActivityStatus =
  | "not_started"
  | "missed"
  | "in_progress"
  | "completed"
  | "expired";

export type AssignmentHistorySource = {
  assignmentId: string;
  assignmentTitle: string;
  assignmentStatus: "draft" | "active" | "closed";
  studentId: string;
  studentName: string;
  schoolName: string | null;
  gradeLabel: string | null;
  datasetId: string;
  datasetTitle: string;
  unitIds: string[];
  unitLabels: string[];
  questionCount: number;
  englishToKoreanRatio: number;
  timeLimitSeconds: number;
  passingScore: number;
  questionOrderMode: "fixed" | "random";
  availableUntil: string | null;
  assignedAt: string;
};

export type AttemptHistorySource = {
  id: string;
  assignmentId: string;
  studentId: string;
  attemptNumber: number;
  status: Exclude<AssignmentActivityStatus, "not_started" | "missed">;
  phase: "initial" | "review" | "retry" | "completed";
  questionCount: number;
  timeLimitSeconds: number;
  passingScore: number;
  initialCorrectCount: number | null;
  retryCorrectCount: number | null;
  unresolvedWrongCount: number | null;
  initialScore: number | null;
  finalScore: number | null;
  passed: boolean | null;
  startedAt: string;
  deadlineAt: string;
  completedAt: string | null;
};

export type AssignmentHistorySummary = AssignmentHistorySource & {
  id: string;
  attemptId: string | null;
  attemptNumber: number | null;
  status: AssignmentActivityStatus;
  phase: AttemptHistorySource["phase"] | null;
  activityAt: string;
  initialCorrectCount: number | null;
  retryCorrectCount: number | null;
  unresolvedWrongCount: number | null;
  initialScore: number | null;
  finalScore: number | null;
  passed: boolean | null;
  startedAt: string | null;
  deadlineAt: string | null;
  completedAt: string | null;
};

function pairKey(assignmentId: string, studentId: string) {
  return `${assignmentId}\u0000${studentId}`;
}

export function buildAssignmentHistory(
  assignments: AssignmentHistorySource[],
  attempts: AttemptHistorySource[],
  now = Date.now(),
): AssignmentHistorySummary[] {
  const attemptsByAssignmentStudent = new Map<
    string,
    AttemptHistorySource[]
  >();

  for (const attempt of attempts) {
    const key = pairKey(attempt.assignmentId, attempt.studentId);
    const current = attemptsByAssignmentStudent.get(key) ?? [];
    current.push(attempt);
    attemptsByAssignmentStudent.set(key, current);
  }

  const history: AssignmentHistorySummary[] = [];
  for (const assignment of assignments) {
    const matchingAttempts =
      attemptsByAssignmentStudent.get(
        pairKey(assignment.assignmentId, assignment.studentId),
      ) ?? [];

    if (matchingAttempts.length === 0) {
      const availableUntil = assignment.availableUntil
        ? Date.parse(assignment.availableUntil)
        : Number.NaN;
      const missed =
        !Number.isNaN(availableUntil) && availableUntil <= now;
      history.push({
        ...assignment,
        id: `${missed ? "missed" : "not-started"}:${
          assignment.assignmentId
        }:${assignment.studentId}`,
        attemptId: null,
        attemptNumber: null,
        status: missed ? "missed" : "not_started",
        phase: null,
        activityAt:
          missed && assignment.availableUntil
            ? assignment.availableUntil
            : assignment.assignedAt,
        initialCorrectCount: null,
        retryCorrectCount: null,
        unresolvedWrongCount: null,
        initialScore: null,
        finalScore: null,
        passed: null,
        startedAt: null,
        deadlineAt: null,
        completedAt: null,
      });
      continue;
    }

    for (const attempt of matchingAttempts) {
      const deadline = Date.parse(attempt.deadlineAt);
      const effectiveStatus =
        attempt.status === "in_progress" &&
        attempt.phase !== "review" &&
        !Number.isNaN(deadline) &&
        deadline <= now
          ? "expired"
          : attempt.status;
      history.push({
        ...assignment,
        id: attempt.id,
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: effectiveStatus,
        phase: attempt.phase,
        activityAt: attempt.startedAt,
        questionCount: attempt.questionCount,
        timeLimitSeconds: attempt.timeLimitSeconds,
        passingScore: attempt.passingScore,
        initialCorrectCount: attempt.initialCorrectCount,
        retryCorrectCount: attempt.retryCorrectCount,
        unresolvedWrongCount: attempt.unresolvedWrongCount,
        initialScore: attempt.initialScore,
        finalScore: attempt.finalScore,
        passed: attempt.passed,
        startedAt: attempt.startedAt,
        deadlineAt: attempt.deadlineAt,
        completedAt: attempt.completedAt,
      });
    }
  }

  return history.toSorted(
    (left, right) =>
      Date.parse(right.activityAt) - Date.parse(left.activityAt),
  );
}
