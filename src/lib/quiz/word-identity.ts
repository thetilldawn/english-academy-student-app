import type { QuizDirection, QuizVocabularyEntry } from "./question-types";

export function normalizeQuizChoice(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function normalizeQuizHeadword(value: string): string {
  return normalizeQuizChoice(value).replaceAll("*", "");
}

export function quizVocabularyIdentity(
  entry: QuizVocabularyEntry,
): string {
  const canonicalKey = entry.canonicalKey?.trim();

  return canonicalKey
    ? `canonical:${canonicalKey}`
    : `headword:${normalizeQuizHeadword(entry.headword)}`;
}

export function quizTargetDirectionConflictKey(
  entry: QuizVocabularyEntry,
  direction: QuizDirection,
) {
  return direction === "english_to_korean"
    ? {
        promptKey: normalizeQuizHeadword(entry.headword),
        answerKey: normalizeQuizChoice(entry.primaryMeaning),
      }
    : {
        promptKey: normalizeQuizChoice(entry.primaryMeaning),
        answerKey: normalizeQuizHeadword(entry.headword),
      };
}

