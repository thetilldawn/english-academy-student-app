import type { BulkCollisionDecision } from "./model";

export type VocabCollisionDecisionInput = {
  collisionId: string;
  mode: "skip" | "move" | "allow";
  availableFrom: string;
  availableUntil: string | null;
  studentId: string;
  studentName: string;
  sourceSessionNumber: number;
  unitLabel: string | null;
  warningMessage: string;
  warningKind: "existing_assignment" | "planned_series_order";
};

export type VocabCollisionDecisionRecord = Omit<
  VocabCollisionDecisionInput,
  "mode"
> & {
  decision: BulkCollisionDecision;
};

function sameCollisionChain(
  left: VocabCollisionDecisionRecord,
  right: VocabCollisionDecisionRecord,
) {
  return left.studentId === right.studentId &&
    left.sourceSessionNumber === right.sourceSessionNumber;
}

export function setVocabCollisionDecision(
  current: readonly VocabCollisionDecisionRecord[],
  next: VocabCollisionDecisionRecord,
): VocabCollisionDecisionRecord[] {
  const existingIndex = current.findIndex(
    (record) => record.decision.collisionId === next.decision.collisionId,
  );
  const existing = existingIndex >= 0 ? current[existingIndex] : null;
  const value = existing
    ? {
        ...next,
        availableFrom: existing.availableFrom,
        availableUntil: existing.availableUntil,
        warningMessage: existing.warningMessage,
        warningKind: existing.warningKind,
      }
    : next;
  return [
    ...current.filter(
      (record, index) =>
        index !== existingIndex &&
        !(
          existing &&
          index > existingIndex &&
          sameCollisionChain(record, existing)
        ),
    ),
    value,
  ];
}

export function clearVocabCollisionDecisionFrom(
  current: readonly VocabCollisionDecisionRecord[],
  collisionId: string,
): VocabCollisionDecisionRecord[] {
  const targetIndex = current.findIndex(
    (record) => record.decision.collisionId === collisionId,
  );
  const target = targetIndex >= 0 ? current[targetIndex] : null;
  if (!target) return [...current];
  return current.filter(
    (record, index) =>
      index < targetIndex || !sameCollisionChain(record, target),
  );
}
