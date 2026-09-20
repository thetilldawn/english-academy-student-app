import "server-only";
import { createExplicitTargetedQuizQuestions } from "@/lib/quiz/question-generator";
import { buildDirectionalQuestionSets, buildQuizChoiceIndex } from "@/lib/quiz/choice-policy";
import { normalizeQuizChoice, normalizeQuizHeadword } from "@/lib/quiz/word-identity";
import type { QuizQuestionDraft, QuizVocabularyEntry } from "@/lib/quiz/question-types";
import type { CompositionPreparation } from "../../contracts/library-materialization";

/** Freeze usable generated questions. Scope-specific ambiguity is checked again
 * when querying candidates and writing the exact assignment, not across units. */
export function planCompositionQuestions(preparation: CompositionPreparation): QuizQuestionDraft[] {
  const entries: QuizVocabularyEntry[] = preparation.entries.filter(e => e.sourceKind !== "reviewed_exam");
  const questions: QuizQuestionDraft[] = [];
  const choiceIndex = buildQuizChoiceIndex(entries, { groupBySimilarity: true });
  // Keep the full candidate pool and the shared similarity policy. Filling
  // random bytes in bounded blocks avoids a system call for every candidate.
  const randomValues = new Uint32Array(16_384);
  let randomOffset = randomValues.length;
  const random = () => {
    if (randomOffset === randomValues.length) { globalThis.crypto.getRandomValues(randomValues); randomOffset = 0; }
    return randomValues[randomOffset++]! / 0x1_0000_0000;
  };
  for (const direction of ["english_to_korean", "korean_to_english"] as const) {
    // Keep conflicting prompts in different batches so a future smaller unit
    // selection can use either occurrence. The shared generator still checks
    // every target, direction, prompt, and distractor set.
    const remaining = entries.filter(e => e.eligibleDirections?.includes(direction));
    while (remaining.length) {
      const batch: QuizVocabularyEntry[] = [], prompts = new Map<string, string>();
      for (let i = 0; i < remaining.length && batch.length < 500;) {
        const e = remaining[i]!;
        const prompt = direction === "english_to_korean" ? normalizeQuizHeadword(e.headword) : normalizeQuizChoice(e.primaryMeaning);
        const answer = direction === "english_to_korean" ? normalizeQuizChoice(e.primaryMeaning) : normalizeQuizHeadword(e.headword);
        if (prompts.has(prompt) && prompts.get(prompt) !== answer) { i++; continue; }
        prompts.set(prompt, answer); batch.push(e); remaining.splice(i, 1);
      }
      const eligible = buildDirectionalQuestionSets(batch, entries);
      const targets = (direction === "english_to_korean" ? eligible.englishCandidates : eligible.koreanCandidates).map(e => ({ id: e.id, direction }));
      if (targets.length) questions.push(...createExplicitTargetedQuizQuestions(targets, entries, random, { choiceIndex }));
    }
  }
  return questions;
}
