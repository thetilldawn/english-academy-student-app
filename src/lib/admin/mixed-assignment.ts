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

export type PendingReviewCandidateIdentity = {
  vocabEntryId: number;
  canonicalDictionaryId: string | null;
  canonicalLexemeId: string | null;
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

export function isCandidateInReviewScope(
  scope: "dataset" | "selection",
  candidateUnitId: string,
  selectedUnitIds: ReadonlySet<string>,
) {
  return scope === "dataset" || selectedUnitIds.has(candidateUnitId);
}

function candidateMatchesPendingIdentity(
  candidate: EligibleVocabularyEntry,
  pending: PendingReviewCandidateIdentity,
) {
  if (
    candidate.canonicalDictionaryId !== null &&
    pending.canonicalDictionaryId !== null
  ) {
    return (
      candidate.canonicalDictionaryId ===
      pending.canonicalDictionaryId
    );
  }
  if (
    candidate.canonicalLexemeId !== null &&
    pending.canonicalLexemeId !== null
  ) {
    return candidate.canonicalLexemeId === pending.canonicalLexemeId;
  }
  return candidate.id === pending.vocabEntryId;
}

export function resolvePendingReviewCandidate(
  candidates: readonly EligibleVocabularyEntry[],
  pending: PendingReviewCandidateIdentity,
  scope: "dataset" | "selection",
  selectedUnitIds: ReadonlySet<string>,
) {
  const scoped = candidates
    .filter(
      (candidate) =>
        isCandidateInReviewScope(
          scope,
          candidate.unitId,
          selectedUnitIds,
        ) && candidateMatchesPendingIdentity(candidate, pending),
    )
    .sort(
      (left, right) =>
        Number(right.id === pending.vocabEntryId) -
          Number(left.id === pending.vocabEntryId) ||
        left.sourceRow - right.sourceRow ||
        left.id - right.id,
    );
  return scoped[0];
}

export function countEligibleReviewLevels(
  levels: readonly (1 | 2)[],
) {
  const level1 = levels.filter((level) => level === 1).length;
  const level2 = levels.filter((level) => level === 2).length;
  return { total: level1 + level2, level1, level2 };
}

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
    return `${datasetLabel} · 오답 재시험 · ${reviewQuestionCount}문항`;
  }

  const unitRange =
    units.length === 1
      ? units[0].unitLabel
      : `${units[0].unitLabel}~${units.at(-1)?.unitLabel}`;
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
