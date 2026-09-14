import type { QuizVocabularyEntry } from "@/lib/quiz/question-types";
import { quizVocabularyIdentity } from "@/lib/quiz/word-identity";

export function assignmentTargetIdentity(entry: QuizVocabularyEntry): string {
  return entry.compositionTargetKey ? `composition:${entry.compositionTargetKey}` : quizVocabularyIdentity(entry);
}

export function compositionExclusionPredicate(candidates: readonly QuizVocabularyEntry[], excludedIds: ReadonlySet<number>) {
  const excludedKeys = new Set(candidates.filter(c => excludedIds.has(c.id) && c.compositionTargetKey).map(c => c.compositionTargetKey));
  return (candidate: QuizVocabularyEntry) => excludedIds.has(candidate.id) ||
    Boolean(candidate.compositionTargetKey && excludedKeys.has(candidate.compositionTargetKey));
}

/** Call only after the requested units and exclusions have been applied. */
export function uniqueCompositionTargets<T extends QuizVocabularyEntry>(candidates: readonly T[], required: readonly QuizVocabularyEntry[] = []): T[] {
  const seen = new Set<string>();
  for (const target of required) {
    if (!target.compositionTargetKey) continue;
    if (seen.has(target.compositionTargetKey)) throw new Error("같은 품사·뜻의 단어가 확정 출제 대상에 두 번 포함됐습니다.");
    seen.add(target.compositionTargetKey);
  }
  return candidates.filter(candidate => {
    const key = candidate.compositionTargetKey;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function assertUniqueCompositionTargets(candidates: readonly QuizVocabularyEntry[]) {
  if (uniqueCompositionTargets(candidates).length !== candidates.length) {
    throw new Error("같은 품사·뜻의 단어가 확정 출제 대상에 두 번 포함됐습니다.");
  }
}
