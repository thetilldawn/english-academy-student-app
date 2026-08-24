import "server-only";

import { createHash } from "node:crypto";

export type ResolvedBulkPlanDigestItem = {
  studentId: string;
  datasetId: string | null;
  sessions: ReadonlyArray<{
    sessionNumber: number;
    sourceSessionNumber: number;
    cycleIndex: number;
    unitIds: readonly string[];
    questionCount: number;
    availableFrom: string;
    availableUntil: string | null;
    allowedCollisionAssignmentIds: readonly string[];
    targets: ReadonlyArray<{
      id: number;
      direction: "english_to_korean" | "korean_to_english";
    }>;
  }>;
};

/**
 * Binds a Preview response to the exact student, range, schedule, target word,
 * and direction plan that the save request must reproduce.
 */
export function resolvedBulkPlanSha256(
  items: readonly ResolvedBulkPlanDigestItem[],
) {
  const canonical = items
    .map((item) => ({
      studentId: item.studentId,
      datasetId: item.datasetId,
      sessions: item.sessions
        .map((session) => ({
          sessionNumber: session.sessionNumber,
          sourceSessionNumber: session.sourceSessionNumber,
          cycleIndex: session.cycleIndex,
          unitIds: [...session.unitIds],
          questionCount: session.questionCount,
          availableFrom: session.availableFrom,
          availableUntil: session.availableUntil,
          allowedCollisionAssignmentIds: [
            ...session.allowedCollisionAssignmentIds,
          ].toSorted(),
          targets: session.targets.map((target) => ({
            id: target.id,
            direction: target.direction,
          })),
        }))
        .toSorted((left, right) => left.sessionNumber - right.sessionNumber),
    }))
    .toSorted((left, right) => left.studentId.localeCompare(right.studentId));

  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}
