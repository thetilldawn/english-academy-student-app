import "server-only";

import type { StudentAttemptResult } from "@/features/results/model";
import { deriveAttemptQuestionMetrics } from "@/lib/quiz/result-presentation";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import {
  loadActiveVocabPronunciationReleaseRegistry,
  loadApprovedKoreanPronunciationRegistry,
  loadSyntheticPronunciationRegistry,
  loadVocabPronunciationRegistry,
} from "./pronunciation-registry";
import {
  mapResultQuestions,
  type AttemptQuestionResult,
  type ResultQuestionRow,
} from "./result-question-mapper";
import {
  oneRelation,
  reviewedExamUseSnapshot,
  type AttemptState,
} from "./question-snapshot";

export async function getAttemptQuestionResults(
  attemptId: string,
): Promise<AttemptQuestionResult[]> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("quiz_questions")
    .select(
      "id, vocab_entry_id, order_index, direction, prompt, choices, correct_choice_index, initial_choice_index, initial_is_correct, retry_choice_index, retry_is_correct, prior_wrong_count, initial_timed_out, retry_timed_out, assignment_question:assignment_questions!quiz_questions_assignment_question_id_fkey(vocab_entry_id, headword_snapshot, primary_meaning_snapshot, provenance_status, exam_use_snapshot:assignment_question_exam_use_snapshot!assignment_question_exam_use_snapshot_question_fkey(release_id, occurrence_id, dictionary_id, pronunciation_variant_id, headword_snapshot, primary_meaning_snapshot, display_pronunciation_ko_snapshot, pronunciation_snapshot, choice_dictionary_snapshots, provenance_status)), vocab_entries(headword, primary_meaning, pronunciation_ko)",
    )
    .eq("attempt_id", attemptId)
    .order("order_index");

  if (error) {
    throw new Error("문항 결과를 불러오지 못했습니다.");
  }

  const rows = (data ?? []) as ResultQuestionRow[];
  const registryIds = rows.flatMap((row) => {
    const bankQuestion = oneRelation(row.assignment_question);
    const vocabEntryId =
      typeof bankQuestion?.vocab_entry_id === "number"
        ? bankQuestion.vocab_entry_id
        : row.vocab_entry_id;
    return typeof vocabEntryId === "number"
      ? [vocabEntryId]
      : [];
  });
  const syntheticBindings = rows.flatMap((row) => {
    const bankQuestion = oneRelation(row.assignment_question);
    const snapshot = reviewedExamUseSnapshot(bankQuestion);
    const vocabEntryId =
      typeof bankQuestion?.vocab_entry_id === "number"
        ? bankQuestion.vocab_entry_id
        : row.vocab_entry_id;
    return typeof snapshot?.release_id === "string" &&
      typeof vocabEntryId === "number"
      ? [{ releaseId: snapshot.release_id, vocabEntryId }]
      : [];
  });
  const approvedDictionaryIds = rows.flatMap((row) => {
    const snapshot = reviewedExamUseSnapshot(oneRelation(row.assignment_question));
    return typeof snapshot?.dictionary_id === "string" ? [snapshot.dictionary_id] : [];
  });
  const [
    pronunciationRegistry,
    syntheticPronunciationRegistry,
    approvedKoreanPronunciationRegistry,
    activeVocaPronunciationRegistry,
  ] = await Promise.all([
    loadVocabPronunciationRegistry(registryIds),
    loadSyntheticPronunciationRegistry(syntheticBindings),
    loadApprovedKoreanPronunciationRegistry(approvedDictionaryIds),
    loadActiveVocabPronunciationReleaseRegistry(registryIds),
  ]);

  return mapResultQuestions(
    rows,
    pronunciationRegistry,
    syntheticPronunciationRegistry,
    new Map(),
    approvedKoreanPronunciationRegistry,
    activeVocaPronunciationRegistry,
  );
}

export async function getAttemptResult(
  studentId: string,
  attemptId: string,
): Promise<StudentAttemptResult | null> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("quiz_attempts")
    .select(
      "id, assignment_id, status, phase, attempt_number, question_count_snapshot, initial_correct_count, retry_correct_count, unresolved_wrong_count, initial_score, final_score, passed, elapsed_seconds, started_at, initial_completed_at, completed_at, assignments(title)",
    )
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }
  const questions = await getAttemptQuestionResults(attemptId);

  const assignment = Array.isArray(data.assignments)
    ? data.assignments[0]
    : data.assignments;
  const reviewing =
    data.status === "in_progress" && data.phase === "review";
  const reviewMetrics = reviewing
    ? deriveAttemptQuestionMetrics(questions)
    : null;
  const reviewElapsedSeconds =
    reviewing && data.initial_completed_at
      ? Math.max(
          0,
          Math.floor(
            (new Date(data.initial_completed_at).getTime() -
              new Date(data.started_at).getTime()) /
              1000,
          ),
        )
      : null;

  return {
    id: data.id,
    title: assignment?.title ?? "단어 시험",
    status: data.status as StudentAttemptResult["status"],
    phase: data.phase as AttemptState["phase"],
    attemptNumber: data.attempt_number,
    questionCount: data.question_count_snapshot,
    initialCorrectCount:
      reviewMetrics?.initialCorrectCount ?? data.initial_correct_count,
    retryCorrectCount:
      reviewMetrics?.retryCorrectCount ?? data.retry_correct_count,
    unresolvedWrongCount:
      reviewMetrics?.unresolvedWrongCount ??
      data.unresolved_wrong_count,
    initialScore:
      reviewMetrics?.initialScore ??
      (data.initial_score === null ? null : Number(data.initial_score)),
    finalScore: data.final_score === null ? null : Number(data.final_score),
    passed: data.passed,
    elapsedSeconds: reviewElapsedSeconds ?? data.elapsed_seconds,
    startedAt: data.started_at,
    initialCompletedAt: data.initial_completed_at,
    completedAt: data.completed_at,
    questions,
  };
}

