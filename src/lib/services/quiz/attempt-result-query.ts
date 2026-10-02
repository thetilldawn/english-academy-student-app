import "server-only";
import { getAttemptQuestionContents, type AttemptContentActor } from "@/features/quiz-player/public-server-queries";

import type { StudentAttemptResult } from "@/features/results/model";
import { getVocabularyResultRecord } from "@/features/results/public-server";
import { deriveAttemptQuestionMetrics } from "@/lib/quiz/result-presentation";
import { normalizeQuizContentMode } from "@/lib/quiz/question-content-mode";
import { withCorrectedPronunciationAudio } from "@/lib/quiz/pronunciation-snapshot";
import { getStudentAttemptPointSummary } from "@/lib/services/learning-point-read-service";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import {
  loadActiveVocabPronunciationReleaseRegistry,
  loadEntryApprovedKoreanPronunciationRegistry,
  loadEntrySourcePronunciationRegistry,
  loadApprovedKoreanPronunciationRegistry,
  loadSyntheticPronunciationRegistry,
  loadVocabPronunciationRegistry,
  loadPronunciationAudioCorrections,
} from "./pronunciation-registry";
import {
  mapResultQuestions,
  type AttemptQuestionResult,
  type ResultQuestionRow,
} from "./result-question-mapper";
import {
  oneRelation,
  compositionQuestionPronunciation,
  reviewedExamUseSnapshot,
  type AttemptState,
} from "./question-snapshot";

export async function getAttemptQuestionResults(
  attemptId: string,
  actor: AttemptContentActor,
  detailScope: "legacy" | "initial_mistakes" | "summary_only" = "legacy",
): Promise<AttemptQuestionResult[]> {
  if (detailScope === "summary_only") return [];
  const supabase = getServiceSupabaseClient();
  let query = supabase
    .from("quiz_questions")
    .select(
      "id, vocab_entry_id, order_index, direction, correct_choice_index, initial_choice_index, initial_is_correct, retry_choice_index, retry_is_correct, prior_wrong_count, initial_timed_out, retry_timed_out, vocab_entries(headword, primary_meaning, pronunciation_ko)",
    )
    .eq("attempt_id", attemptId);
  if (detailScope === "initial_mistakes") query = query.or("initial_is_correct.is.null,initial_is_correct.eq.false");
  const { data, error } = await query.order("order_index");

  if (error) {
    throw new Error("문항 결과를 불러오지 못했습니다.");
  }

  const stored = (data ?? []) as Omit<ResultQuestionRow, "prompt" | "choices" | "assignment_question">[];
  const contents = await getAttemptQuestionContents(actor, attemptId, stored.map(row => row.id));
  const rows: ResultQuestionRow[] = stored.map(row => {
    const body = contents.get(row.id)!;
    return { ...row, prompt: body.prompt, choices: body.choices, assignment_question: body.assignment_question };
  });
  const registryIds = rows.flatMap((row) => {
    const bankQuestion = oneRelation(row.assignment_question);
    if (compositionQuestionPronunciation(bankQuestion, Array.isArray(row.choices) ? row.choices.length : 0)) return [];
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
    entryApprovedRegistry,
    entrySourceRegistry,
    audioCorrections,
  ] = await Promise.all([
    loadVocabPronunciationRegistry(registryIds),
    loadSyntheticPronunciationRegistry(syntheticBindings),
    loadApprovedKoreanPronunciationRegistry(approvedDictionaryIds),
    loadActiveVocabPronunciationReleaseRegistry(registryIds),
    loadEntryApprovedKoreanPronunciationRegistry(registryIds),
    loadEntrySourcePronunciationRegistry(registryIds),
    loadPronunciationAudioCorrections(),
  ]);

  return mapResultQuestions(
    rows,
    pronunciationRegistry,
    syntheticPronunciationRegistry,
    new Map(),
    approvedKoreanPronunciationRegistry,
    activeVocaPronunciationRegistry,
    entryApprovedRegistry,
    entrySourceRegistry,
  ).map((question) => {
    const originalHeadword = question.direction === "english_to_korean"
      ? question.prompt : question.correctAnswer;
    return { ...question, pronunciation:
      withCorrectedPronunciationAudio(question.pronunciation, originalHeadword, audioCorrections) };
  });
}

export async function getAttemptResult(
  studentId: string,
  attemptId: string,
): Promise<StudentAttemptResult | null> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("quiz_attempts")
    .select(
      "id, assignment_id, status, phase, attempt_number, question_count_snapshot, initial_correct_count, retry_correct_count, unresolved_wrong_count, initial_score, final_score, passed, elapsed_seconds, started_at, initial_completed_at, completed_at, assignments(title, quiz_content_mode)",
    )
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) {
    throw new Error("시험 결과를 불러오지 못했습니다.", { cause: error });
  }
  if (!data) {
    return null;
  }
  const resultRecord = await getVocabularyResultRecord(attemptId, { kind: "student", id: studentId });
  if (!resultRecord) return null;
  const snapshot = resultRecord.attempt;
  const [questions, pointSummary] = await Promise.all([
    getAttemptQuestionResults(attemptId, { kind: "student", studentId }, resultRecord.detailScope),
    getStudentAttemptPointSummary(studentId, attemptId),
  ]);

  const assignment = Array.isArray(data.assignments)
    ? data.assignments[0]
    : data.assignments;
  const reviewing =
    snapshot.status === "in_progress" && snapshot.phase === "review";
  const initial = resultRecord.phases.find(phase => phase.phase === "initial");
  const retry = resultRecord.phases.find(phase => phase.phase === "retry");
  const reviewMetrics = resultRecord.retentionPolicy === "summary_and_mistakes_v1" && initial
    ? { initialCorrectCount: initial.correctCount, retryCorrectCount: retry?.correctCount ?? snapshot.retryCorrectCount ?? 0,
      unresolvedWrongCount: retry ? initial.targetCount - initial.correctCount - retry.correctCount
        : snapshot.unresolvedWrongCount ?? initial.targetCount - initial.correctCount, initialScore: initial.score }
    : reviewing
    ? deriveAttemptQuestionMetrics(questions)
    : null;
  const reviewElapsedSeconds =
    reviewing && snapshot.initialCompletedAt
      ? Math.max(
          0,
          Math.floor(
            (new Date(snapshot.initialCompletedAt).getTime() -
              new Date(snapshot.startedAt).getTime()) /
              1000,
          ),
        )
      : null;

  return {
    resultRecord,
    id: data.id,
    title: assignment?.title ?? "단어 시험",
    quizContentMode: normalizeQuizContentMode(
      assignment?.quiz_content_mode ?? "legacy_book_meaning_choice",
    ),
    status: snapshot.status as StudentAttemptResult["status"],
    phase: snapshot.phase as AttemptState["phase"],
    attemptNumber: snapshot.attemptNumber,
    questionCount: snapshot.questionCount,
    initialCorrectCount:
      reviewMetrics?.initialCorrectCount ?? snapshot.initialCorrectCount,
    retryCorrectCount:
      reviewMetrics?.retryCorrectCount ?? snapshot.retryCorrectCount,
    unresolvedWrongCount:
      reviewMetrics?.unresolvedWrongCount ??
      snapshot.unresolvedWrongCount,
    initialScore:
      reviewMetrics?.initialScore ??
      (snapshot.initialScore === null ? null : Number(snapshot.initialScore)),
    finalScore: snapshot.finalScore === null ? null : Number(snapshot.finalScore),
    passed: snapshot.passed,
    elapsedSeconds: reviewElapsedSeconds ?? snapshot.elapsedSeconds,
    startedAt: snapshot.startedAt,
    initialCompletedAt: snapshot.initialCompletedAt,
    completedAt: snapshot.completedAt,
    pointSummary,
    questions,
  };
}
