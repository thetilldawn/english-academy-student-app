import type { EligibleVocabularyEntry } from "@/lib/quiz/eligible-vocabulary";
import {
  normalizeQuizHeadword,
  quizVocabularyIdentity,
} from "@/lib/quiz/engine";
import { resolveOrderedContiguousUnits } from "@/lib/admin/unit-range";

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

export function mixedAssignmentPrimaryUnitIds(
  primaryUnitIds: readonly string[],
  reviewQuestionCount: number,
  totalQuestionCount: number,
) {
  return reviewQuestionCount === totalQuestionCount
    ? []
    : [...primaryUnitIds];
}

export function mixedAssignmentGeneratedTitle(
  datasetLabel: string,
  units: readonly MixedAssignmentUnit[],
  reviewQuestionCount: number,
  totalQuestionCount: number,
) {
  if (reviewQuestionCount === totalQuestionCount) {
    return `${datasetLabel} · 오답 시험 · ${reviewQuestionCount}문항`;
  }

  const contiguous = units.every(
    (unit, index) =>
      index === 0 ||
      Math.abs(unit.sortIndex - units[index - 1]!.sortIndex) === 1,
  );
  const unitRange = units.length === 1
    ? units[0].unitLabel
    : contiguous
      ? `${units[0].unitLabel}~${units.at(-1)?.unitLabel}`
      : `${units[0].unitLabel} 외 ${units.length - 1}개`;
  return [
    datasetLabel,
    unitRange,
    `틀렸던 단어 ${reviewQuestionCount}개 포함`,
  ]
    .filter(Boolean)
    .join(" · ");
}

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
  return resolveOrderedContiguousUnits(availableUnits, primaryUnitIds);
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
