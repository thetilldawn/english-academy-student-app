export type QuizDirection =
  | "english_to_korean"
  | "korean_to_english";

export type QuizVocabularyEntry = {
  /** Composed books only: shared for reviewed meanings, unique per unreviewed occurrence. */
  compositionTargetKey?: string;
  id: number;
  headword: string;
  primaryMeaning: string;
  canonicalKey?: string | null;
  recordType?: "word" | "root_affix" | "expression" | null;
  eligibleDirections?: readonly QuizDirection[];
};

export type QuizQuestionDraft = {
  vocabEntryId: number;
  direction: QuizDirection;
  prompt: string;
  choices: string[];
  choiceVocabEntryIds: number[];
  correctChoiceIndex: number;
};

export type RandomSource = () => number;
