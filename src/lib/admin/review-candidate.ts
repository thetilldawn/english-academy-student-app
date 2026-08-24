import type { EligibleVocabularyEntry } from "@/lib/quiz/eligible-vocabulary";

export type ReviewCandidateIdentity = {
  vocabEntryId: number;
  canonicalDictionaryId: string | null;
  canonicalLexemeId: string | null;
};

export function isCandidateInReviewScope(
  scope: "dataset" | "selection",
  candidateUnitId: string,
  selectedUnitIds: ReadonlySet<string>,
) {
  return scope === "dataset" || selectedUnitIds.has(candidateUnitId);
}

function candidateMatchesReviewIdentity(
  candidate: EligibleVocabularyEntry,
  review: ReviewCandidateIdentity,
) {
  if (
    candidate.canonicalDictionaryId !== null &&
    review.canonicalDictionaryId !== null
  ) {
    return candidate.canonicalDictionaryId === review.canonicalDictionaryId;
  }
  if (
    candidate.canonicalLexemeId !== null &&
    review.canonicalLexemeId !== null
  ) {
    return candidate.canonicalLexemeId === review.canonicalLexemeId;
  }
  return candidate.id === review.vocabEntryId;
}

export function resolveReviewCandidate(
  candidates: readonly EligibleVocabularyEntry[],
  review: ReviewCandidateIdentity,
  scope: "dataset" | "selection",
  selectedUnitIds: ReadonlySet<string>,
) {
  return candidates
    .filter(
      (candidate) =>
        isCandidateInReviewScope(
          scope,
          candidate.unitId,
          selectedUnitIds,
        ) && candidateMatchesReviewIdentity(candidate, review),
    )
    .sort(
      (left, right) =>
        Number(right.id === review.vocabEntryId) -
          Number(left.id === review.vocabEntryId) ||
        left.sourceRow - right.sourceRow ||
        left.id - right.id,
    )[0];
}

export function countReviewLevels(levels: readonly (1 | 2)[]) {
  const level1 = levels.filter((level) => level === 1).length;
  const level2 = levels.filter((level) => level === 2).length;
  return { total: level1 + level2, level1, level2 };
}
