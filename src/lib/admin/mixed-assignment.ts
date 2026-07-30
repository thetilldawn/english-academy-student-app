import type { EligibleVocabularyEntry } from "@/lib/quiz/eligible-vocabulary";
import {
  normalizeQuizHeadword,
  quizVocabularyIdentity,
} from "@/lib/quiz/engine";

export type MixedAssignmentUnit = {
  id: string;
  unitLabel: string;
  sortIndex: number;
};

export type PendingReviewIdentity = {
  vocabEntryId: number;
  canonicalKey: string | null;
  headword?: string;
};

export type MixedAssignmentFailureReason =
  | "forbidden"
  | "conflict"
  | "unavailable"
  | "invalid_selection"
  | "database";

export type MixedAssignmentDatabaseError = {
  code: string;
  message: string;
};

export function mixedAssignmentDatabaseErrorReason(
  error: MixedAssignmentDatabaseError,
): MixedAssignmentFailureReason {
  if (error.code === "42501") return "forbidden";
  if (error.code === "40001") return "conflict";
  if (
    error.code === "22023" &&
    /mixed_regular_target_already_pending_review|review_target_canonical_mapping_changed/.test(
      error.message,
    )
  ) {
    return "conflict";
  }
  if (
    error.code === "22023" &&
    /mixed_review_queue_empty|student_not_active/.test(error.message)
  ) {
    return "unavailable";
  }
  if (
    ["22023", "P0002", "23503", "23505"].includes(error.code)
  ) {
    return "invalid_selection";
  }
  return "database";
}

export function orderContiguousPrimaryUnits(
  availableUnits: readonly MixedAssignmentUnit[],
  primaryUnitIds: readonly string[],
): MixedAssignmentUnit[] {
  if (
    primaryUnitIds.length < 1 ||
    new Set(primaryUnitIds).size !== primaryUnitIds.length
  ) {
    throw new Error("주 DAY 선택이 올바르지 않습니다.");
  }

  const availableById = new Map(
    availableUnits.map((unit) => [unit.id, unit]),
  );
  const selected = primaryUnitIds.flatMap((unitId) => {
    const unit = availableById.get(unitId);
    return unit ? [unit] : [];
  });
  if (selected.length !== primaryUnitIds.length) {
    throw new Error("선택한 DAY를 사용할 수 없습니다.");
  }

  selected.sort(
    (left, right) => left.sortIndex - right.sortIndex,
  );
  if (
    selected.some(
      (unit, index) =>
        index > 0 &&
        unit.sortIndex !== selected[index - 1].sortIndex + 1,
    )
  ) {
    throw new Error("주 DAY는 연속된 범위여야 합니다.");
  }
  return selected;
}

export function excludePendingReviewCandidates(
  candidates: readonly EligibleVocabularyEntry[],
  pendingIdentities: readonly PendingReviewIdentity[],
) {
  const pendingEntryIds = new Set(
    pendingIdentities.map((identity) => identity.vocabEntryId),
  );
  const pendingKeys = new Set(
    pendingIdentities.map((identity) => {
      if (identity.canonicalKey) {
        return `canonical:${identity.canonicalKey}`;
      }
      const headwordKey = identity.headword
        ? normalizeQuizHeadword(identity.headword)
        : "";
      return headwordKey
        ? `headword:${headwordKey}`
        : `entry:${identity.vocabEntryId}`;
    }),
  );

  return candidates.filter(
    (candidate) =>
      !pendingEntryIds.has(candidate.id) &&
      !pendingKeys.has(quizVocabularyIdentity(candidate)),
  );
}
