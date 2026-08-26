import "server-only";

import {
  isTrustedQuestionSnapshot,
  type QuestionProvenanceStatus,
} from "@/lib/quiz/question-provenance";

import {
  buildStudentWrongWordHistory,
  wrongWordReviewIdentity,
  type PendingWrongWordReview,
  type ActiveWrongWordAssignmentSource,
  type StudentWrongWordHistory,
  type WrongEntrySource,
  type WrongEventSource,
  type WrongQuestionSource,
  type WrongWordStateSource,
} from "@/lib/admin/wrong-word-history";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import {
  loadActiveReviewAssignments,
  type ActiveAssignmentWord,
} from "@/lib/services/active-review-assignment-service";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const WRONG_EVENT_PAGE_SIZE = 500;
const RELATION_CHUNK_SIZE = 200;

type WrongEventRow = {
  id: number | string;
  quiz_attempt_id: string;
  quiz_question_id: string;
  dataset_id: string;
  vocab_entry_id: number;
  canonical_dictionary_id_snapshot: string | null;
  canonical_lexeme_id_snapshot: string | null;
  wrong_stage: "initial" | "retry";
  wrong_at: string;
};

type QuestionSnapshot = {
  headword_snapshot: string | null;
  primary_meaning_snapshot: string | null;
  provenance_status: QuestionProvenanceStatus;
  exam_use_snapshot?:
    | ExamUseQuestionSnapshot
    | ExamUseQuestionSnapshot[]
    | null;
};

type ExamUseQuestionSnapshot = {
  headword_snapshot: string;
  primary_meaning_snapshot: string;
  provenance_status: "reviewed_for_preview_v1";
};

type QuestionRow = {
  id: string;
  vocab_entry_id: number;
  initial_is_correct: boolean | null;
  retry_is_correct: boolean | null;
  assignment_question:
    | QuestionSnapshot
    | QuestionSnapshot[]
    | null;
};

type DatasetRelation = {
  title: string;
  edition: string | null;
};

type EntryRow = {
  id: number;
  dataset_id: string;
  headword: string;
  headword_normalized: string;
  primary_meaning: string;
  dataset: DatasetRelation | DatasetRelation[] | null;
};

type PendingReviewRow = {
  id: string;
  dataset_id: string;
  vocab_entry_id: number;
  canonical_dictionary_id_snapshot: string | null;
  canonical_lexeme_id_snapshot: string | null;
  source_question_id: string;
  reason_level: 1 | 2;
  queued_at: string;
  reserved_review_draft_id: string | null;
};

type VocabStateRow = {
  vocab_entry_id: number;
  canonical_dictionary_id_snapshot: string | null;
  unresolved_wrong_count: number;
  resolved_at: string | null;
  last_evaluated_at: string;
};

function oneRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function chunks<T>(values: readonly T[]) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += RELATION_CHUNK_SIZE) {
    result.push(values.slice(index, index + RELATION_CHUNK_SIZE));
  }
  return result;
}

export async function getStudentWrongWordHistory(
  studentId: string,
  authenticatedAdmin?: AdminContext,
): Promise<StudentWrongWordHistory | null> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  const supabase = getServiceSupabaseClient();
  const authenticatedSupabase = await createServerSupabaseClient();
  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id")
    .eq("id", studentId)
    .maybeSingle();

  if (studentError || !student) return null;
  const eventRows: WrongEventRow[] = [];
  let beforeId: number | string | null = null;

  while (true) {
    let query = supabase
      .from("student_vocab_wrong_events")
      .select(
        "id, quiz_attempt_id, quiz_question_id, dataset_id, vocab_entry_id, canonical_dictionary_id_snapshot, canonical_lexeme_id_snapshot, wrong_stage, wrong_at",
      )
      .eq("student_id", studentId)
      .eq("wrong_stage", "initial")
      .order("id", { ascending: false })
      .limit(WRONG_EVENT_PAGE_SIZE);
    if (beforeId !== null) {
      query = query.lt("id", beforeId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error("오답 이력을 불러오지 못했습니다.");
    }
    const page = (data ?? []) as WrongEventRow[];
    eventRows.push(...page);
    if (page.length < WRONG_EVENT_PAGE_SIZE) break;
    beforeId = page.at(-1)?.id ?? null;
    if (beforeId === null) break;
  }
  const pendingReviewRows: PendingReviewRow[] = [];
  for (let offset = 0; ; offset += WRONG_EVENT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("student_vocab_review_queue")
      .select(
        "id, dataset_id, vocab_entry_id, canonical_dictionary_id_snapshot, canonical_lexeme_id_snapshot, source_question_id, reason_level, queued_at, reserved_review_draft_id",
      )
      .eq("student_id", studentId)
      .eq("status", "pending")
      .order("queued_at", { ascending: false })
      .order("id")
      .range(offset, offset + WRONG_EVENT_PAGE_SIZE - 1);
    if (error) {
      throw new Error("오답 복습 대기열을 불러오지 못했습니다.");
    }
    pendingReviewRows.push(...((data ?? []) as PendingReviewRow[]));
    if (!data || data.length < WRONG_EVENT_PAGE_SIZE) break;
  }
  const activeAssignmentWords: ActiveAssignmentWord[] = [];
  const activeDatasetIds = unique([
    ...eventRows.map((event) => event.dataset_id),
    ...pendingReviewRows.map((row) => row.dataset_id),
  ]);
  for (const datasetId of activeDatasetIds) {
    const active = await loadActiveReviewAssignments(
      authenticatedSupabase,
      [studentId],
      datasetId,
    );
    activeAssignmentWords.push(...active.words);
  }

  const questionIds = unique(
    eventRows.map((event) => event.quiz_question_id),
  );
  const vocabEntryIds = unique(
    [
      ...eventRows.map((event) => event.vocab_entry_id),
      ...pendingReviewRows.map((row) => row.vocab_entry_id),
      ...activeAssignmentWords.map((word) => word.vocabEntryId),
    ],
  );
  const questionRows: QuestionRow[] = [];
  const entryRows: EntryRow[] = [];
  const vocabStateRows: VocabStateRow[] = [];
  for (const idChunk of chunks(questionIds)) {
    const { data, error } = await supabase
      .from("quiz_questions")
      .select(
        "id, vocab_entry_id, initial_is_correct, retry_is_correct, assignment_question:assignment_questions!quiz_questions_assignment_question_id_fkey(headword_snapshot, primary_meaning_snapshot, provenance_status, exam_use_snapshot:assignment_question_exam_use_snapshot!assignment_question_exam_use_snapshot_question_fkey(headword_snapshot, primary_meaning_snapshot, provenance_status))",
      )
      .in("id", idChunk);
    if (error) throw new Error("오답 문항 이력을 불러오지 못했습니다.");
    questionRows.push(...((data ?? []) as QuestionRow[]));
  }

  for (const idChunk of chunks(vocabEntryIds)) {
    const { data, error } = await supabase
      .from("vocab_entries")
      .select(
        "id, dataset_id, headword, headword_normalized, primary_meaning, dataset:vocab_datasets(title, edition)",
      )
      .in("id", idChunk);
    if (error) throw new Error("오답 단어 정보를 불러오지 못했습니다.");
    entryRows.push(...((data ?? []) as EntryRow[]));

    const { data: stateData, error: stateError } = await supabase
      .from("student_vocab_state")
      .select(
        "vocab_entry_id, canonical_dictionary_id_snapshot, unresolved_wrong_count, resolved_at, last_evaluated_at",
      )
      .eq("student_id", studentId)
      .in("vocab_entry_id", idChunk);
    if (stateError) {
      throw new Error("현재 오답 상태를 불러오지 못했습니다.");
    }
    vocabStateRows.push(...((stateData ?? []) as VocabStateRow[]));
  }

  const entryById = new Map(entryRows.map((entry) => [entry.id, entry]));
  const entries = entryRows.map((entry): WrongEntrySource => {
    const dataset = oneRelation(entry.dataset);
    return {
      id: entry.id,
      datasetId: entry.dataset_id,
      datasetLabel:
        [dataset?.title, dataset?.edition].filter(Boolean).join(" · ") ||
        "단어장",
      headword: entry.headword,
      headwordNormalized: entry.headword_normalized,
      primaryMeaning: entry.primary_meaning,
    };
  });
  const pendingReviews = pendingReviewRows.map(
    (row): PendingWrongWordReview => ({
      queueId: row.id,
      key: wrongWordReviewIdentity(
        row.dataset_id,
        row.vocab_entry_id,
        row.canonical_lexeme_id_snapshot,
        entryById.get(row.vocab_entry_id)?.headword_normalized,
        row.canonical_dictionary_id_snapshot,
      ),
      datasetId: row.dataset_id,
      vocabEntryId: row.vocab_entry_id,
      canonicalDictionaryId: row.canonical_dictionary_id_snapshot,
      canonicalLexemeId: row.canonical_lexeme_id_snapshot,
      sourceQuestionId: row.source_question_id,
      reasonLevel: row.reason_level,
      queuedAt: row.queued_at,
      reviewDraftId: row.reserved_review_draft_id,
    }),
  );
  const questions = questionRows.flatMap(
    (question): WrongQuestionSource[] => {
      const entry = entryById.get(question.vocab_entry_id);
      if (!entry) return [];
      const snapshot = oneRelation(question.assignment_question);
      const examUseSnapshot = oneRelation(
        snapshot?.exam_use_snapshot ?? null,
      );
      const reviewedExamUseSnapshot =
        examUseSnapshot?.provenance_status ===
        "reviewed_for_preview_v1"
          ? examUseSnapshot
          : null;
      const verified = isTrustedQuestionSnapshot(
        snapshot?.provenance_status,
      );
      return [
        {
          id: question.id,
          vocabEntryId: question.vocab_entry_id,
          initialIsCorrect: question.initial_is_correct,
          retryIsCorrect: question.retry_is_correct,
          headword:
            reviewedExamUseSnapshot?.headword_snapshot ??
            (verified ? snapshot.headword_snapshot : null) ??
            entry.headword,
          primaryMeaning:
            reviewedExamUseSnapshot?.primary_meaning_snapshot ??
            (verified ? snapshot.primary_meaning_snapshot : null) ??
            entry.primary_meaning,
          provenanceStatus:
            reviewedExamUseSnapshot?.provenance_status ??
            snapshot?.provenance_status ??
            "legacy_backfill",
        },
      ];
    },
  );
  const events = eventRows.map(
    (event): WrongEventSource => ({
      attemptId: event.quiz_attempt_id,
      questionId: event.quiz_question_id,
      datasetId: event.dataset_id,
      vocabEntryId: event.vocab_entry_id,
      canonicalDictionaryId:
        event.canonical_dictionary_id_snapshot,
      canonicalLexemeId: event.canonical_lexeme_id_snapshot,
      stage: event.wrong_stage,
      wrongAt: event.wrong_at,
    }),
  );
  const states = vocabStateRows.map(
    (state): WrongWordStateSource => ({
      vocabEntryId: state.vocab_entry_id,
      unresolvedWrongCount: state.unresolved_wrong_count,
      resolvedAt: state.resolved_at,
      lastEvaluatedAt: state.last_evaluated_at,
    }),
  );
  const activeAssignments = activeAssignmentWords.map(
    (target): ActiveWrongWordAssignmentSource => ({
      key: wrongWordReviewIdentity(
        target.datasetId,
        target.vocabEntryId,
        target.canonicalLexemeId,
        target.headwordNormalized,
        target.canonicalDictionaryId,
      ),
      assignmentId: target.assignmentId,
      title: target.title,
      assignedAt: target.assignedAt,
    }),
  );

  return buildStudentWrongWordHistory({
    activeAssignments,
    entries,
    events,
    pendingReviews,
    questions,
    states,
  });
}
