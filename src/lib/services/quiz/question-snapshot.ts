import type { TimingMode } from "@/lib/admin/assignment-settings";
import type { QuizPronunciation } from "@/lib/quiz/pronunciation-snapshot";
import type { QuestionProvenanceStatus } from "@/lib/quiz/question-provenance";

export type AttemptQuestionState = {
  id: string;
  orderIndex: number;
  direction: "english_to_korean" | "korean_to_english";
  prompt: string;
  choices: string[];
  pronunciation: QuizPronunciation;
  choicePronunciations: QuizPronunciation[];
  initialChoiceIndex: number | null;
  initialIsCorrect: boolean | null;
  retryChoiceIndex: number | null;
  retryIsCorrect: boolean | null;
  priorWrongLevel: 0 | 1 | 2;
  initialTimedOut: boolean;
  retryTimedOut: boolean;
  revealedCorrectChoiceIndex: number | null;
};

export type AttemptState = {
  id: string;
  assignmentTitle: string;
  status: "in_progress" | "completed" | "expired";
  phase: "initial" | "review" | "retry" | "completed";
  startedAt: string;
  deadlineAt: string;
  timerDeadlineAt: string;
  timingMode: TimingMode;
  questionTimeLimitSeconds: number | null;
  questions: AttemptQuestionState[];
  currentQuestionId: string | null;
};

export function completeChoiceVocabEntryIds(
  value: unknown,
  choiceCount: number,
): Array<number | null> {
  if (
    !Array.isArray(value) ||
    value.length !== choiceCount ||
    !value.every(
      (item) => typeof item === "number" && Number.isSafeInteger(item),
    )
  ) {
    return Array.from({ length: choiceCount }, () => null);
  }
  return value;
}

export type ExamUseQuestionSnapshot = {
  release_id?: string;
  occurrence_id?: string;
  dictionary_id?: string;
  pronunciation_variant_id?: string | null;
  headword_snapshot: string;
  primary_meaning_snapshot: string;
  display_pronunciation_ko_snapshot: string | null;
  pronunciation_snapshot: unknown;
  choice_dictionary_snapshots: unknown;
  provenance_status: "reviewed_for_preview_v1";
};

export type AssignmentQuestionSnapshot = {
  vocab_entry_id?: number;
  choice_vocab_entry_ids?: number[] | null;
  headword_snapshot: string | null;
  primary_meaning_snapshot: string | null;
  provenance_status: QuestionProvenanceStatus;
  exam_use_snapshot?:
    | ExamUseQuestionSnapshot
    | ExamUseQuestionSnapshot[]
    | null;
};

export function oneRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function reviewedExamUseSnapshot(
  question: AssignmentQuestionSnapshot | null,
): ExamUseQuestionSnapshot | null {
  const snapshot = oneRelation(question?.exam_use_snapshot ?? null);
  return snapshot?.provenance_status === "reviewed_for_preview_v1"
    ? snapshot
    : null;
}
