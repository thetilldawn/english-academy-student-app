import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

export type BulkScheduleWindow = {
  availableFrom: string;
  availableUntil: string | null;
};

export type ExistingScheduledAssignment = {
  assignmentId: string;
  assignmentTitle: string;
  availableFrom: string;
};

export type BulkScheduleCollisionDecision = {
  collisionId: string;
  mode: "skip" | "move" | "allow";
  movedAvailableFrom: string | null;
  movedAvailableUntil: string | null;
};

export type BulkScheduleCollisionWarning = {
  id: string;
  kind: "existing_assignment" | "planned_series_order";
  existingAssignmentId: string | null;
  existingAssignmentTitle: string;
  message: string;
  resolved: boolean;
};

type ResolvedScheduleSession = {
  sourceSessionNumber: number;
  available: boolean;
  availableFrom: string;
  availableUntil: string | null;
  questionCount: number;
  warnings: BulkScheduleCollisionWarning[];
  error: string | null;
};

function koreanDateKey(value: string) {
  return isoToKoreanDateTimeLocal(value).slice(0, 10);
}

export function bulkScheduleCollisionId(
  studentId: string,
  sourceSessionNumber: number,
  existingAssignmentId: string,
) {
  return `${studentId}:${sourceSessionNumber}:${existingAssignmentId}`;
}

function collisionsAt(
  studentId: string,
  sourceSessionNumber: number,
  schedule: BulkScheduleWindow,
  existingAssignments: readonly ExistingScheduledAssignment[],
) {
  const candidateDate = koreanDateKey(schedule.availableFrom);
  return existingAssignments.filter(
    (assignment) => koreanDateKey(assignment.availableFrom) === candidateDate,
  ).map((assignment) => ({
    assignment,
    collisionId: bulkScheduleCollisionId(
      studentId,
      sourceSessionNumber,
      assignment.assignmentId,
    ),
  }));
}

export function resolveBulkScheduleCollision(input: {
  studentId: string;
  sourceSessionNumber: number;
  schedule: BulkScheduleWindow;
  existingAssignments: readonly ExistingScheduledAssignment[];
  decisions: readonly BulkScheduleCollisionDecision[];
}):
  | { kind: "skip" }
  | {
      kind: "scheduled";
      schedule: BulkScheduleWindow;
      warnings: BulkScheduleCollisionWarning[];
      unresolved: boolean;
    } {
  const decisionById = new Map(
    input.decisions.map((decision) => [decision.collisionId, decision]),
  );
  let schedule = { ...input.schedule };
  let current = collisionsAt(
    input.studentId,
    input.sourceSessionNumber,
    schedule,
    input.existingAssignments,
  );
  const appliedMoves = new Set<string>();
  for (let step = 0; step <= input.decisions.length; step += 1) {
    if (
      current.some(
        ({ collisionId }) => decisionById.get(collisionId)?.mode === "skip",
      )
    ) {
      return { kind: "skip" };
    }
    const moveEntry = current
      .map(({ collisionId }) => ({
        collisionId,
        decision: decisionById.get(collisionId),
      }))
      .find(
        ({ collisionId, decision }) =>
          !appliedMoves.has(collisionId) &&
          decision?.mode === "move" &&
          decision.movedAvailableFrom &&
          decision.movedAvailableUntil,
      );
    if (!moveEntry?.decision) break;
    appliedMoves.add(moveEntry.collisionId);
    schedule = {
      availableFrom: moveEntry.decision.movedAvailableFrom!,
      availableUntil: moveEntry.decision.movedAvailableUntil,
    };
    current = collisionsAt(
      input.studentId,
      input.sourceSessionNumber,
      schedule,
      input.existingAssignments,
    );
  }
  const final = current;
  const warnings = final.map(({ assignment, collisionId }) => {
    const decision = decisionById.get(collisionId);
    const resolved = decision?.mode === "allow";
    return {
      id: collisionId,
      kind: "existing_assignment" as const,
      existingAssignmentId: assignment.assignmentId,
      existingAssignmentTitle: assignment.assignmentTitle,
      message: `같은 날 \"${assignment.assignmentTitle}\" 시험이 있습니다.`,
      resolved,
    };
  });

  return {
    kind: "scheduled",
    schedule,
    warnings,
    unresolved: warnings.some((warning) => !warning.resolved),
  };
}

export function enforceIncreasingResolvedSchedules<
  Session extends ResolvedScheduleSession,
>(input: {
  studentId: string;
  sessions: readonly Session[];
  decisions: readonly BulkScheduleCollisionDecision[];
}): Session[] {
  const sessions = input.sessions.map((session) => ({
    ...session,
    warnings: [...session.warnings],
  })) as Session[];
  const moveDecisionFor = (sourceSessionNumber: number) =>
    input.decisions.find(
      (decision) =>
        decision.mode === "move" &&
        decision.collisionId.startsWith(
          `${input.studentId}:${sourceSessionNumber}:`,
        ),
    );

  for (let index = 1; index < sessions.length; index += 1) {
    const previous = sessions[index - 1]!;
    const current = sessions[index]!;
    if (
      Date.parse(current.availableFrom) > Date.parse(previous.availableFrom) &&
      koreanDateKey(current.availableFrom) !== koreanDateKey(previous.availableFrom)
    ) {
      continue;
    }
    const previousMove = moveDecisionFor(previous.sourceSessionNumber);
    const currentMove = moveDecisionFor(current.sourceSessionNumber);
    const decision = previousMove ?? currentMove;
    const targetIndex = previousMove ? index - 1 : index;
    const target = sessions[targetIndex]!;
    const message = "이동한 날짜가 이번 배정의 다른 회차와 겹칩니다.";
    sessions[targetIndex] = {
      ...target,
      available: false,
      questionCount: 0,
      error: message,
      warnings: decision
        ? [
            ...target.warnings,
            {
              id: decision.collisionId,
              kind: "planned_series_order",
              existingAssignmentId: null,
              existingAssignmentTitle: "이번 배정의 다른 회차",
              message,
              resolved: false,
            },
          ]
        : target.warnings,
    };
  }
  return sessions;
}
