import "server-only";

import type { TimingMode } from "@/lib/admin/assignment-settings";
import {
  parseChoiceDictionaryIds,
  parseChoicePronunciations,
  parseTargetPronunciation,
  preferredPronunciationWithActiveVocaRelease,
  syntheticPronunciationBindingKey,
  unavailablePronunciation,
  withPronunciationDisplay,
} from "@/lib/quiz/pronunciation-snapshot";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import {
  loadActiveVocabPronunciationReleaseRegistry,
  loadApprovedKoreanPronunciationRegistry,
  loadSyntheticPronunciationRegistry,
  loadVocabPronunciationDisplayRegistry,
  loadVocabPronunciationRegistry,
} from "./pronunciation-registry";
import {
  completeChoiceVocabEntryIds,
  oneRelation,
  reviewedExamUseSnapshot,
  type AssignmentQuestionSnapshot,
  type AttemptState,
} from "./question-snapshot";

type QuestionRow = {
  id: string;
  vocab_entry_id: number | null;
  order_index: number;
  direction: "english_to_korean" | "korean_to_english";
  prompt: string;
  choices: string[];
  correct_choice_index: number;
  initial_choice_index: number | null;
  initial_is_correct: boolean | null;
  retry_choice_index: number | null;
  retry_is_correct: boolean | null;
  initial_timed_out?: boolean;
  retry_timed_out?: boolean;
  prior_wrong_count: number;
  assignment_question:
    | AssignmentQuestionSnapshot
    | AssignmentQuestionSnapshot[]
    | null;
};

export async function getStudentAttempt(
  studentId: string,
  attemptId: string,
): Promise<AttemptState | null> {
  const supabase = getServiceSupabaseClient();
  const { data: attemptData, error: attemptError } = await supabase
    .from("quiz_attempts")
    .select(
      "id, assignment_id, status, phase, started_at, deadline_at, current_question_started_at",
    )
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (attemptError) throw attemptError;
  if (!attemptData) return null;

  const [assignmentResult, questionResult] =
    await Promise.all([
      supabase
        .from("assignments")
        .select("title, timing_mode, question_time_limit_seconds")
        .eq("id", attemptData.assignment_id)
        .maybeSingle(),
      supabase
        .from("quiz_questions")
        .select(
          "id, vocab_entry_id, order_index, direction, prompt, choices, correct_choice_index, initial_choice_index, initial_is_correct, retry_choice_index, retry_is_correct, prior_wrong_count, initial_timed_out, retry_timed_out, assignment_question:assignment_questions!quiz_questions_assignment_question_id_fkey(vocab_entry_id, choice_vocab_entry_ids, headword_snapshot, primary_meaning_snapshot, provenance_status, exam_use_snapshot:assignment_question_exam_use_snapshot!assignment_question_exam_use_snapshot_question_fkey(release_id, occurrence_id, dictionary_id, pronunciation_variant_id, headword_snapshot, primary_meaning_snapshot, display_pronunciation_ko_snapshot, pronunciation_snapshot, choice_dictionary_snapshots, provenance_status))",
        )
        .eq("attempt_id", attemptId)
        .order("order_index"),
    ]);

  if (assignmentResult.error) throw assignmentResult.error;
  if (questionResult.error) throw questionResult.error;
  if (!assignmentResult.data) {
    throw new Error("quiz_assignment_missing");
  }

  const assignmentData = assignmentResult.data;
  const questionData = questionResult.data;

  const rows = (questionData ?? []) as QuestionRow[];
  const registryIds = rows.flatMap((question) => {
    const bankQuestion = oneRelation(question.assignment_question);
    const targetVocabEntryId =
      typeof bankQuestion?.vocab_entry_id === "number"
        ? bankQuestion.vocab_entry_id
        : question.vocab_entry_id;
    return [
      targetVocabEntryId,
      ...(bankQuestion?.choice_vocab_entry_ids ?? []),
    ].filter((value): value is number => typeof value === "number");
  });
  const approvedDictionaryIds = rows.flatMap((question) => {
    const bankQuestion = oneRelation(question.assignment_question);
    const snapshot = reviewedExamUseSnapshot(bankQuestion);
    if (!snapshot) return [];
    const choiceIds = parseChoiceDictionaryIds(
      snapshot.choice_dictionary_snapshots,
      question.choices,
    ).filter((value): value is string => typeof value === "string");
    return [
      ...(typeof snapshot.dictionary_id === "string"
        ? [snapshot.dictionary_id]
        : []),
      ...choiceIds,
    ];
  });
  const syntheticBindings = rows.flatMap((question) => {
    const bankQuestion = oneRelation(question.assignment_question);
    const snapshot = reviewedExamUseSnapshot(bankQuestion);
    if (typeof snapshot?.release_id !== "string") return [];
    const targetVocabEntryId =
      typeof bankQuestion?.vocab_entry_id === "number"
        ? bankQuestion.vocab_entry_id
        : question.vocab_entry_id;
    return [
      targetVocabEntryId,
      ...(bankQuestion?.choice_vocab_entry_ids ?? []),
    ]
      .filter((value): value is number => typeof value === "number")
      .map((vocabEntryId) => ({
        releaseId: snapshot.release_id as string,
        vocabEntryId,
      }));
  });
  const [
    pronunciationRegistry,
    syntheticPronunciationRegistry,
    pronunciationDisplayRegistry,
    approvedKoreanPronunciationRegistry,
    activeVocaPronunciationRegistry,
  ] = await Promise.all([
    loadVocabPronunciationRegistry(registryIds),
    loadSyntheticPronunciationRegistry(syntheticBindings),
    loadVocabPronunciationDisplayRegistry(registryIds),
    loadApprovedKoreanPronunciationRegistry(approvedDictionaryIds),
    loadActiveVocabPronunciationReleaseRegistry(registryIds),
  ]);
  const initialCurrent = rows.find(
    (question) => question.initial_choice_index === null,
  );
  const retryCurrent = rows.find(
    (question) =>
      question.initial_is_correct === false &&
      question.retry_choice_index === null,
  );
  const phase: AttemptState["phase"] =
    attemptData.status !== "in_progress"
      ? "completed"
      : attemptData.phase;
  const currentQuestionId =
    phase === "initial"
      ? (initialCurrent?.id ?? null)
      : phase === "retry"
        ? (retryCurrent?.id ?? null)
        : null;
  if (
    attemptData.status === "in_progress" &&
    (phase === "initial" || phase === "retry") &&
    (!questionData || questionData.length === 0 || !currentQuestionId)
  ) {
    throw new Error("quiz_attempt_question_state_invalid");
  }
  const timingMode =
    (assignmentData?.timing_mode as TimingMode | undefined) ?? "total";
  const questionTimeLimitSeconds =
    assignmentData?.question_time_limit_seconds ?? null;
  const timerDeadlineAt =
    timingMode === "per_question" && questionTimeLimitSeconds
      ? new Date(
          Date.parse(attemptData.current_question_started_at) +
            questionTimeLimitSeconds * 1000,
        ).toISOString()
      : attemptData.deadline_at;

  return {
    id: attemptData.id,
    assignmentTitle: assignmentData?.title ?? "단어 시험",
    status: attemptData.status,
    phase,
    startedAt: attemptData.started_at,
    deadlineAt: attemptData.deadline_at,
    timerDeadlineAt,
    timingMode,
    questionTimeLimitSeconds,
    currentQuestionId,
    questions: rows.map((question) => {
      const answered =
        question.initial_choice_index !== null ||
        question.retry_choice_index !== null;
      const bankQuestion = oneRelation(question.assignment_question);
      const targetVocabEntryId =
        typeof bankQuestion?.vocab_entry_id === "number"
          ? bankQuestion.vocab_entry_id
          : question.vocab_entry_id;
      const examUseSnapshot = reviewedExamUseSnapshot(bankQuestion);
      const targetDisplayFallback =
        typeof targetVocabEntryId === "number"
          ? pronunciationDisplayRegistry.get(targetVocabEntryId)
          : null;
      const snapshotPronunciation = withPronunciationDisplay(
        examUseSnapshot
          ? parseTargetPronunciation(
              examUseSnapshot.pronunciation_snapshot,
              examUseSnapshot.display_pronunciation_ko_snapshot,
            )
          : unavailablePronunciation(),
        targetDisplayFallback,
      );
      const snapshotChoicePronunciations = examUseSnapshot
        ? parseChoicePronunciations(
            examUseSnapshot.choice_dictionary_snapshots,
            question.choices,
          )
        : question.choices.map(() => unavailablePronunciation());
      const snapshotChoiceDictionaryIds = examUseSnapshot
        ? parseChoiceDictionaryIds(
            examUseSnapshot.choice_dictionary_snapshots,
            question.choices,
          )
        : question.choices.map(() => null);
      const pronunciation = preferredPronunciationWithActiveVocaRelease(
        examUseSnapshot?.dictionary_id,
        snapshotPronunciation,
        typeof targetVocabEntryId === "number"
          ? activeVocaPronunciationRegistry.get(targetVocabEntryId)
          : undefined,
        typeof targetVocabEntryId === "number"
          ? pronunciationRegistry.get(targetVocabEntryId)
          : undefined,
        typeof examUseSnapshot?.release_id === "string" &&
          typeof targetVocabEntryId === "number"
          ? syntheticPronunciationRegistry.get(
              syntheticPronunciationBindingKey(
                examUseSnapshot.release_id,
                targetVocabEntryId,
              ),
            )
          : undefined,
        approvedKoreanPronunciationRegistry,
      );
      const choiceVocabEntryIds = completeChoiceVocabEntryIds(
        bankQuestion?.choice_vocab_entry_ids,
        question.choices.length,
      );
      const choicePronunciations = question.choices.map((_, index) => {
        const choiceVocabEntryId = choiceVocabEntryIds[index];
        const choiceDictionaryId = snapshotChoiceDictionaryIds[index];
        const choiceSnapshotPronunciation =
          snapshotChoicePronunciations[index] ?? unavailablePronunciation();
        return preferredPronunciationWithActiveVocaRelease(
          choiceDictionaryId,
          withPronunciationDisplay(
            choiceSnapshotPronunciation,
            typeof choiceVocabEntryId === "number"
              ? pronunciationDisplayRegistry.get(choiceVocabEntryId)
              : null,
          ),
          typeof choiceVocabEntryId === "number"
            ? activeVocaPronunciationRegistry.get(choiceVocabEntryId)
            : undefined,
          typeof choiceVocabEntryId === "number"
            ? pronunciationRegistry.get(choiceVocabEntryId)
            : undefined,
          typeof examUseSnapshot?.release_id === "string" &&
            typeof choiceVocabEntryId === "number"
            ? syntheticPronunciationRegistry.get(
                syntheticPronunciationBindingKey(
                  examUseSnapshot.release_id,
                  choiceVocabEntryId,
                ),
              )
            : undefined,
          approvedKoreanPronunciationRegistry,
        );
      });

      return {
        id: question.id,
        orderIndex: question.order_index,
        direction: question.direction,
        prompt: question.prompt,
        choices: question.choices,
        pronunciation,
        choicePronunciations,
        initialChoiceIndex: question.initial_choice_index,
        initialIsCorrect: question.initial_is_correct,
        retryChoiceIndex: question.retry_choice_index,
        retryIsCorrect: question.retry_is_correct,
        priorWrongLevel:
          question.prior_wrong_count >= 2
            ? 2
            : question.prior_wrong_count === 1
              ? 1
              : 0,
        initialTimedOut: Boolean(question.initial_timed_out),
        retryTimedOut: Boolean(question.retry_timed_out),
        revealedCorrectChoiceIndex: answered
          ? question.correct_choice_index
          : null,
      };
    }),
  };
}
