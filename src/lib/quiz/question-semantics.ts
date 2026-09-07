import type { QuizContentMode } from "./question-content-mode";
import type { QuizDirection } from "./question-types";

export type QuizTextRole = "headword" | "korean_meaning" | "english_definition" | "english_example";

/** Language alone does not imply a word, nor permission to play its audio. */
export function questionSemantics(mode: QuizContentMode, direction: QuizDirection): {
  prompt: QuizTextRole; choice: QuizTextRole;
} {
  if (mode === "book_meaning_choice") {
    return direction === "english_to_korean"
      ? { prompt: "headword", choice: "korean_meaning" }
      : { prompt: "korean_meaning", choice: "headword" };
  }
  if (mode === "canonical_headword_to_definition" && direction === "english_to_korean") {
    return { prompt: "headword", choice: "english_definition" };
  }
  if (mode === "canonical_definition_to_headword" && direction === "korean_to_english") {
    return { prompt: "english_definition", choice: "headword" };
  }
  if (mode === "canonical_example_to_headword" && direction === "korean_to_english") {
    return { prompt: "english_example", choice: "headword" };
  }
  throw new Error("시험 유형과 출제 방향이 맞지 않습니다.");
}
