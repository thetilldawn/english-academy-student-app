export const quizContentModes = [
  "book_meaning_choice",
  "canonical_definition_to_headword",
  "canonical_example_to_headword",
] as const;

export type QuizContentMode = (typeof quizContentModes)[number];

export function isCanonicalQuizContentMode(
  value: QuizContentMode,
): value is Exclude<QuizContentMode, "book_meaning_choice"> {
  return value !== "book_meaning_choice";
}

export function normalizeQuizContentMode(value: unknown): QuizContentMode {
  if (value === "legacy_book_meaning_choice") {
    return "book_meaning_choice";
  }
  if (
    typeof value === "string" &&
    (quizContentModes as readonly string[]).includes(value)
  ) {
    return value as QuizContentMode;
  }
  throw new Error("지원하지 않는 시험 문제 유형입니다.");
}
