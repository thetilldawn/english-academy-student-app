import type { AttemptResultQuestion } from "@/features/results/model";
import {
  parseTargetPronunciation,
  preferredPronunciationWithActiveVocaRelease,
  syntheticPronunciationBindingKey,
  unavailablePronunciation,
  withPronunciationDisplay,
  type QuizPronunciation,
} from "@/lib/quiz/pronunciation-snapshot";
import { isTrustedQuestionSnapshot } from "@/lib/quiz/question-provenance";
import {
  oneRelation,
  reviewedExamUseSnapshot,
  type AssignmentQuestionSnapshot,
} from "./question-snapshot";

export type AttemptQuestionResult = AttemptResultQuestion;

export type ResultQuestionRow = {
  id: string;
  vocab_entry_id: number | null;
  order_index: number;
  direction: "english_to_korean" | "korean_to_english";
  prompt: string;
  choices: unknown;
  correct_choice_index: number;
  initial_choice_index: number | null;
  initial_is_correct: boolean | null;
  retry_choice_index: number | null;
  retry_is_correct: boolean | null;
  prior_wrong_count: number;
  initial_timed_out?: boolean;
  retry_timed_out?: boolean;
  assignment_question:
    | AssignmentQuestionSnapshot
    | AssignmentQuestionSnapshot[]
    | null;
  vocab_entries:
    | {
        headword: string;
        primary_meaning: string;
        pronunciation_ko: string | null;
      }
    | Array<{
        headword: string;
        primary_meaning: string;
        pronunciation_ko: string | null;
      }>
    | null;
};

export function mapResultQuestions(
  rows: ResultQuestionRow[],
  pronunciationRegistry: ReadonlyMap<number, QuizPronunciation> = new Map(),
  syntheticPronunciationRegistry: ReadonlyMap<string, QuizPronunciation> =
    new Map(),
  pronunciationDisplayRegistry: ReadonlyMap<number, string> = new Map(),
  approvedKoreanPronunciationRegistry: ReadonlyMap<
    string,
    QuizPronunciation
  > = new Map(),
  activeVocaPronunciationRegistry: ReadonlyMap<number, QuizPronunciation> =
    new Map(),
): AttemptQuestionResult[] {
  return rows.map((row) => {
    const choices = Array.isArray(row.choices)
      ? row.choices.filter(
          (choice): choice is string => typeof choice === "string",
        )
      : [];
    const vocabulary = Array.isArray(row.vocab_entries)
      ? row.vocab_entries[0]
      : row.vocab_entries;
    const bankQuestion = oneRelation(row.assignment_question);
    const examUseSnapshot = reviewedExamUseSnapshot(bankQuestion);
    const vocabEntryId =
      typeof bankQuestion?.vocab_entry_id === "number"
        ? bankQuestion.vocab_entry_id
        : row.vocab_entry_id;
    const displayFallback =
      (vocabEntryId === null
        ? null
        : pronunciationDisplayRegistry.get(vocabEntryId)) ??
      vocabulary?.pronunciation_ko ??
      null;
    const snapshotPronunciation = withPronunciationDisplay(
      examUseSnapshot
        ? parseTargetPronunciation(
            examUseSnapshot.pronunciation_snapshot,
            examUseSnapshot.display_pronunciation_ko_snapshot,
          )
        : unavailablePronunciation(),
      displayFallback,
    );
    const pronunciation = preferredPronunciationWithActiveVocaRelease(
      examUseSnapshot?.dictionary_id,
      snapshotPronunciation,
      vocabEntryId === null
        ? undefined
        : activeVocaPronunciationRegistry.get(vocabEntryId),
      vocabEntryId === null
        ? undefined
        : pronunciationRegistry.get(vocabEntryId),
      typeof examUseSnapshot?.release_id === "string" &&
        typeof vocabEntryId === "number"
        ? syntheticPronunciationRegistry.get(
            syntheticPronunciationBindingKey(
              examUseSnapshot.release_id,
              vocabEntryId,
            ),
          )
        : undefined,
      approvedKoreanPronunciationRegistry,
    );
    const verifiedSnapshot = isTrustedQuestionSnapshot(
      bankQuestion?.provenance_status,
    )
      ? bankQuestion
      : null;

    return {
      id: row.id,
      orderIndex: row.order_index,
      direction: row.direction,
      prompt: row.prompt,
      correctAnswer: choices[row.correct_choice_index] ?? "",
      correctChoiceIndex: row.correct_choice_index,
      initialChoice:
        Boolean(row.initial_timed_out) ||
        row.initial_choice_index === null
          ? null
          : (choices[row.initial_choice_index] ?? null),
      initialIsCorrect: row.initial_is_correct,
      retryChoice:
        Boolean(row.retry_timed_out) ||
        row.retry_choice_index === null
          ? null
          : (choices[row.retry_choice_index] ?? null),
      retryIsCorrect: row.retry_is_correct,
      wrongCount:
        Math.max(0, row.prior_wrong_count) +
        (row.initial_is_correct === false ? 1 : 0),
      headword:
        examUseSnapshot?.headword_snapshot ??
        verifiedSnapshot?.headword_snapshot ??
        vocabulary?.headword ??
        "",
      primaryMeaning:
        examUseSnapshot?.primary_meaning_snapshot ??
        verifiedSnapshot?.primary_meaning_snapshot ??
        vocabulary?.primary_meaning ??
        "",
      pronunciation,
      provenanceStatus:
        examUseSnapshot?.provenance_status ??
        verifiedSnapshot?.provenance_status ?? "legacy_backfill",
    };
  });
}

